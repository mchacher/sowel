#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Sowel shadow deployment lifecycle
# ============================================================
#
# Manages the candidate-image shadow stack on sowelox:
#   - up:      build current branch into a Docker image, transfer to
#              sowelox, create the shadow-influx + sowel-shadow
#              containers, start them with SOWEL_SHADOW_MODE=1.
#              Idempotent on the network and Influx; always recreates
#              sowel-shadow so it picks up the latest image.
#   - update:  alias for `up` — same idempotent recreate path.
#   - down:    stop and remove the shadow containers + Docker network,
#              keep /opt/sowel-shadow/ for post-mortem.
#   - destroy: down + delete /opt/sowel-shadow/ (data + influx volume).
#              IRREVERSIBLE.
#   - status:  print what is deployed / running.
#
# Usage:
#   ./scripts/shadow-deploy.sh up
#   ./scripts/shadow-deploy.sh update
#   ./scripts/shadow-deploy.sh down
#   ./scripts/shadow-deploy.sh destroy
#   ./scripts/shadow-deploy.sh status
#
# Daily start/stop (after `up`) is handled by `run-swap.sh shadow`.
#
# Safety:
# - Prod is untouched. The shadow runs on port 3001 in its own Docker
#   network with its own InfluxDB. The candidate image carries
#   spec 124's runtime gates, and we set SOWEL_SHADOW_MODE=1 anyway.
# - Refuses to deploy if prod sowel container is not running
#   (sowelox is in a degraded state — fix that first).
# - Never pushes the candidate image to ghcr.io. Tag is local-only.
#
# See dev-notes/shadow-instance.md for the full playbook.
# ============================================================

SOWELOX_HOST="mchacher@192.168.0.230"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHADOW_DIR_ON_REMOTE="/opt/sowel-shadow"
SHADOW_NETWORK="sowel-shadow-net"
SHADOW_INFLUX_CONTAINER="shadow-influx"
SHADOW_SOWEL_CONTAINER="sowel-shadow"
SHADOW_INFLUX_TOKEN="shadow-influx-token"
SHADOW_PORT=3001

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}→${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1" >&2; }

confirm() {
  local prompt="$1"
  read -r -p "$prompt [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

# ------------------------------------------------------------
# Pre-flight
# ------------------------------------------------------------

assert_clean_repo() {
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    warn "Working tree is not clean. The shadow image will include uncommitted changes."
    confirm "Continue anyway?" || exit 1
  fi
}

assert_prod_running() {
  if ! ssh -o ConnectTimeout=5 "$SOWELOX_HOST" \
    "docker ps --format '{{.Names}}' | grep -q '^sowel\$'" 2>/dev/null; then
    err "Prod sowel container is not running on sowelox."
    err "Refusing to deploy shadow on a degraded host — fix prod first."
    exit 1
  fi
}

current_image_tag() {
  local branch sha
  branch=$(git -C "$REPO_ROOT" branch --show-current)
  sha=$(git -C "$REPO_ROOT" rev-parse --short HEAD)
  # Slashes in branch names break docker tags — substitute dashes.
  echo "sowel:shadow-${branch//\//-}-${sha}"
}

# ------------------------------------------------------------
# Build + transfer
# ------------------------------------------------------------

build_image() {
  local tag="$1"
  log "Building $tag from $REPO_ROOT"
  (cd "$REPO_ROOT" && docker build -t "$tag" .)
  ok "Image built"
}

transfer_image() {
  local tag="$1"
  log "Transferring image to sowelox (docker save | gzip | ssh | gunzip | docker load)..."
  docker save "$tag" | gzip | ssh "$SOWELOX_HOST" "gunzip | docker load"
  ok "Image loaded on sowelox"
}

# ------------------------------------------------------------
# Remote stack management
# ------------------------------------------------------------
#
# All remote commands run through ssh "bash <<EOF" blocks. We pin
# `set -euo pipefail` inside each so a failure on sowelox propagates
# back to this script's exit code.

remote_ensure_dirs() {
  ssh "$SOWELOX_HOST" bash <<EOF
set -euo pipefail
if [[ ! -d "$SHADOW_DIR_ON_REMOTE" ]]; then
  sudo mkdir -p "$SHADOW_DIR_ON_REMOTE/data" "$SHADOW_DIR_ON_REMOTE/influx"
  sudo chown -R \$(id -u):\$(id -g) "$SHADOW_DIR_ON_REMOTE"
fi
EOF
}

remote_ensure_network() {
  ssh "$SOWELOX_HOST" bash <<EOF
set -euo pipefail
if ! docker network inspect $SHADOW_NETWORK >/dev/null 2>&1; then
  docker network create $SHADOW_NETWORK
fi
EOF
}

remote_ensure_influx() {
  ssh "$SOWELOX_HOST" bash <<EOF
set -euo pipefail
if ! docker ps -a --format '{{.Names}}' | grep -q '^$SHADOW_INFLUX_CONTAINER\$'; then
  docker run -d --name $SHADOW_INFLUX_CONTAINER \\
    --network $SHADOW_NETWORK \\
    -v $SHADOW_DIR_ON_REMOTE/influx:/var/lib/influxdb2 \\
    -e DOCKER_INFLUXDB_INIT_MODE=setup \\
    -e DOCKER_INFLUXDB_INIT_USERNAME=shadow \\
    -e DOCKER_INFLUXDB_INIT_PASSWORD=shadowpass \\
    -e DOCKER_INFLUXDB_INIT_ORG=sowel \\
    -e DOCKER_INFLUXDB_INIT_BUCKET=sowel \\
    -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=$SHADOW_INFLUX_TOKEN \\
    influxdb:2.7
elif ! docker ps --format '{{.Names}}' | grep -q '^$SHADOW_INFLUX_CONTAINER\$'; then
  docker start $SHADOW_INFLUX_CONTAINER
fi
EOF
}

remote_recreate_sowel() {
  local image_tag="$1"
  ssh "$SOWELOX_HOST" bash <<EOF
set -euo pipefail

if docker ps -a --format '{{.Names}}' | grep -q '^$SHADOW_SOWEL_CONTAINER\$'; then
  docker rm -f $SHADOW_SOWEL_CONTAINER
fi

docker run -d --name $SHADOW_SOWEL_CONTAINER \\
  --network $SHADOW_NETWORK \\
  -p $SHADOW_PORT:3000 \\
  -v $SHADOW_DIR_ON_REMOTE/data:/app/data \\
  -e TZ=Europe/Paris \\
  -e INFLUX_URL=http://$SHADOW_INFLUX_CONTAINER:8086 \\
  -e INFLUX_TOKEN=$SHADOW_INFLUX_TOKEN \\
  -e INFLUX_ORG=sowel \\
  -e INFLUX_BUCKET=sowel \\
  -e SOWEL_SHADOW_MODE=1 \\
  $image_tag

# Wait up to 30s for the safety banner.
for _ in {1..30}; do
  if docker logs $SHADOW_SOWEL_CONTAINER 2>&1 | grep -q "SHADOW MODE ACTIVE"; then
    echo "Shadow safety banner observed."
    exit 0
  fi
  sleep 1
done

echo "ERROR: shadow safety banner not observed after 30s." >&2
docker logs $SHADOW_SOWEL_CONTAINER 2>&1 | tail -30 >&2
exit 1
EOF
}

# ------------------------------------------------------------
# Commands
# ------------------------------------------------------------

cmd_up() {
  assert_clean_repo
  assert_prod_running

  local tag
  tag=$(current_image_tag)

  echo
  log "Deploying shadow stack on sowelox"
  log "Branch: $(git -C "$REPO_ROOT" branch --show-current) @ $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  log "Image:  $tag"
  echo

  build_image "$tag"
  transfer_image "$tag"
  remote_ensure_network
  remote_ensure_dirs
  remote_ensure_influx
  remote_recreate_sowel "$tag"

  echo
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN} ✓ Shadow deployed (side-by-side with prod)${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo "  Prod    : http://192.168.0.230:3000 (untouched)"
  echo "  Shadow  : http://192.168.0.230:$SHADOW_PORT (SOWEL_SHADOW_MODE=1)"
  echo
  echo "  Image  : $tag"
  echo "  Data   : $SHADOW_DIR_ON_REMOTE/data on sowelox"
  echo "  Influx : $SHADOW_INFLUX_CONTAINER (port not exposed)"
  echo
  echo "  Daily start/stop: ./scripts/run-swap.sh shadow {start|stop}"
  echo "  Restore         : open the shadow UI, Admin > Backup > Restore"
  echo "                    with a backup downloaded from the prod UI"
  echo "  Tear down       : $0 down"
  echo "  Destroy data    : $0 destroy"
  echo
}

cmd_down() {
  echo
  log "Tearing down shadow stack on sowelox (data dir preserved)"
  echo

  ssh "$SOWELOX_HOST" bash <<EOF
set -euo pipefail
docker rm -f $SHADOW_SOWEL_CONTAINER 2>/dev/null || true
docker rm -f $SHADOW_INFLUX_CONTAINER 2>/dev/null || true
docker network rm $SHADOW_NETWORK 2>/dev/null || true
if [[ -d "$SHADOW_DIR_ON_REMOTE" ]]; then
  echo "Shadow data dir kept at $SHADOW_DIR_ON_REMOTE (\$(sudo du -sh $SHADOW_DIR_ON_REMOTE 2>/dev/null | cut -f1)). Remove with: $0 destroy"
fi
EOF

  ok "Shadow torn down"
}

cmd_destroy() {
  warn "This will delete $SHADOW_DIR_ON_REMOTE/ on sowelox (data + influx)."
  warn "IRREVERSIBLE."
  confirm "Proceed?" || { log "Aborted."; exit 0; }

  cmd_down

  log "Deleting $SHADOW_DIR_ON_REMOTE on sowelox..."
  ssh "$SOWELOX_HOST" "sudo rm -rf $SHADOW_DIR_ON_REMOTE"
  ok "Shadow data dir removed"
}

cmd_status() {
  echo
  log "Shadow deployment state on sowelox"
  echo

  local out
  out=$(ssh -o ConnectTimeout=5 "$SOWELOX_HOST" bash <<'EOF' 2>/dev/null || true
set -u
echo "--- containers ---"
docker ps -a --filter 'name=sowel-shadow' --filter 'name=shadow-influx' \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true
echo "--- network ---"
docker network ls --filter 'name=sowel-shadow-net' --format '{{.Name}}' || true
echo "--- data dir ---"
if [[ -d /opt/sowel-shadow ]]; then
  sudo du -sh /opt/sowel-shadow/data /opt/sowel-shadow/influx 2>/dev/null || ls -la /opt/sowel-shadow
else
  echo "(/opt/sowel-shadow does not exist)"
fi
EOF
)
  echo "$out"
  echo
}

# ------------------------------------------------------------
# Entrypoint
# ------------------------------------------------------------

case "${1:-}" in
  up|update) cmd_up ;;
  down)      cmd_down ;;
  destroy)   cmd_destroy ;;
  status)    cmd_status ;;
  *)
    echo "Usage: $0 {up|update|down|destroy|status}"
    echo
    echo "  up       Build current branch, transfer to sowelox, create+start the shadow stack"
    echo "  update   Alias for up (rebuild + recreate the sowel-shadow container with the new image)"
    echo "  down     Stop and remove the shadow containers + network. Keep data dir."
    echo "  destroy  down + delete /opt/sowel-shadow on sowelox. IRREVERSIBLE."
    echo "  status   Print containers + network + data dir state on sowelox"
    echo
    echo "Daily start/stop after deployment: ./scripts/run-swap.sh shadow {start|stop}"
    echo
    exit 1
    ;;
esac
