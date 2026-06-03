#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Sowel shadow deployment lifecycle
# ============================================================
#
# Manages the candidate-image shadow stack — by default on the local
# Mac (Docker Desktop), or optionally on sowelox side-by-side with prod.
#
# Commands:
#   - up:      build current branch into a Docker image, create the
#              shadow-influx + sowel-shadow containers, start them with
#              SOWEL_SHADOW_MODE=1. Idempotent on network and Influx;
#              always recreates sowel-shadow so it picks up the latest
#              image. On --target=sowelox, also transfers the image
#              via docker save | ssh | docker load.
#   - update:  alias for `up`.
#   - down:    stop and remove the shadow containers + Docker network,
#              keep the data dir for post-mortem.
#   - destroy: down + delete the data dir. IRREVERSIBLE.
#   - status:  print what is deployed / running.
#
# Targets:
#   --target=local     Mac, http://localhost:3001 (default — per
#                      dev-notes/shadow-instance.md, shadow should
#                      run on a machine that is NOT sowelox).
#   --target=sowelox   side-by-side with prod, http://192.168.0.230:3001
#
# Usage:
#   ./scripts/shadow-deploy.sh up                       # local (default)
#   ./scripts/shadow-deploy.sh up --target=local
#   ./scripts/shadow-deploy.sh up --target=sowelox
#   ./scripts/shadow-deploy.sh down
#   ./scripts/shadow-deploy.sh destroy
#   ./scripts/shadow-deploy.sh status
#
# After `up`, daily start/stop is handled by `run-swap.sh shadow`.
# The chosen target is persisted in data/.shadow-target so the toggle
# script knows which docker daemon to talk to.
#
# Safety:
# - Refuses to deploy with --target=sowelox if prod is not running.
# - Refuses to switch target while a shadow already exists (run `down`
#   or `destroy` first).
# - Refuses if the working tree is dirty (interactive bypass).
# - Image tag is local-only (sowel:shadow-<branch>-<sha>); never pushed.
# - On --target=sowelox, prod container is untouched (port 3000 stays).
#
# See dev-notes/shadow-instance.md for the playbook.
# ============================================================

SOWELOX_HOST="mchacher@192.168.0.230"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_STATE_FILE="$REPO_ROOT/data/.shadow-target"
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
# Target abstraction
# ------------------------------------------------------------
#
# All docker operations route through `run_on_target`. Two backends:
#   - local:   exec the heredoc directly via `bash`
#   - sowelox: pipe the heredoc through `ssh $SOWELOX_HOST bash`
#
# Path of the host data dir, label, URL, and whether to require sudo
# for mkdir are all driven by $TARGET.

target_data_dir() {
  case "$TARGET" in
    local)   echo "$HOME/sowel-shadow" ;;
    sowelox) echo "/opt/sowel-shadow" ;;
  esac
}

target_url() {
  case "$TARGET" in
    local)   echo "http://localhost:$SHADOW_PORT" ;;
    sowelox) echo "http://192.168.0.230:$SHADOW_PORT" ;;
  esac
}

target_mkdir_prefix() {
  # `/opt/...` requires sudo on sowelox; $HOME/... does not on the Mac.
  case "$TARGET" in
    local)   echo "" ;;
    sowelox) echo "sudo " ;;
  esac
}

# Run a heredoc on the target. Usage:
#   cat <<EOF | run_on_target
#   set -euo pipefail
#   ...
#   EOF
run_on_target() {
  case "$TARGET" in
    local)   bash ;;
    sowelox) ssh "$SOWELOX_HOST" bash ;;
  esac
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
  # Only meaningful when shadow runs on the same host as prod.
  [[ "$TARGET" == "sowelox" ]] || return 0
  if ! ssh -o ConnectTimeout=5 "$SOWELOX_HOST" \
    "docker ps --format '{{.Names}}' | grep -q '^sowel\$'" 2>/dev/null; then
    err "Prod sowel container is not running on sowelox."
    err "Refusing to deploy shadow on a degraded host — fix prod first."
    exit 1
  fi
}

assert_no_target_conflict() {
  # If a state file points at a DIFFERENT target than the requested one,
  # refuse: the operator must tear the existing shadow down first.
  if [[ -f "$TARGET_STATE_FILE" ]]; then
    local existing
    existing=$(cat "$TARGET_STATE_FILE")
    if [[ "$existing" != "$TARGET" ]]; then
      err "A shadow is already deployed on target=$existing."
      err "Run \`$0 down --target=$existing\` (or \`destroy\`) before switching to $TARGET."
      exit 1
    fi
  fi
}

current_image_tag() {
  local branch sha
  branch=$(git -C "$REPO_ROOT" branch --show-current)
  sha=$(git -C "$REPO_ROOT" rev-parse --short HEAD)
  echo "sowel:shadow-${branch//\//-}-${sha}"
}

write_target_state() {
  mkdir -p "$(dirname "$TARGET_STATE_FILE")"
  echo "$TARGET" > "$TARGET_STATE_FILE"
}

clear_target_state() {
  rm -f "$TARGET_STATE_FILE"
}

resolved_target_or_die() {
  # For down/destroy/status when --target is not given: read state file.
  if [[ -z "${TARGET:-}" ]]; then
    if [[ -f "$TARGET_STATE_FILE" ]]; then
      TARGET=$(cat "$TARGET_STATE_FILE")
    else
      err "No shadow target known (state file $TARGET_STATE_FILE missing)."
      err "Pass --target=local|sowelox explicitly."
      exit 1
    fi
  fi
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

transfer_image_to_sowelox() {
  local tag="$1"
  [[ "$TARGET" == "sowelox" ]] || return 0
  log "Transferring image to sowelox (docker save | gzip | ssh | gunzip | docker load)..."
  docker save "$tag" | gzip | ssh "$SOWELOX_HOST" "gunzip | docker load"
  ok "Image loaded on sowelox"
}

# ------------------------------------------------------------
# Target operations
# ------------------------------------------------------------

target_ensure_dirs() {
  local data_dir
  data_dir=$(target_data_dir)
  local sudo_prefix
  sudo_prefix=$(target_mkdir_prefix)

  cat <<EOF | run_on_target
set -euo pipefail
if [[ ! -d "$data_dir" ]]; then
  ${sudo_prefix}mkdir -p "$data_dir/data" "$data_dir/influx"
  ${sudo_prefix}chown -R \$(id -u):\$(id -g) "$data_dir" 2>/dev/null || true
fi
EOF
}

target_ensure_network() {
  cat <<EOF | run_on_target
set -euo pipefail
if ! docker network inspect $SHADOW_NETWORK >/dev/null 2>&1; then
  docker network create $SHADOW_NETWORK
fi
EOF
}

target_ensure_influx() {
  local data_dir
  data_dir=$(target_data_dir)

  cat <<EOF | run_on_target
set -euo pipefail
if ! docker ps -a --format '{{.Names}}' | grep -q '^$SHADOW_INFLUX_CONTAINER\$'; then
  docker run -d --name $SHADOW_INFLUX_CONTAINER \\
    --network $SHADOW_NETWORK \\
    -v $data_dir/influx:/var/lib/influxdb2 \\
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

target_recreate_sowel() {
  local image_tag="$1"
  local data_dir
  data_dir=$(target_data_dir)

  cat <<EOF | run_on_target
set -euo pipefail

if docker ps -a --format '{{.Names}}' | grep -q '^$SHADOW_SOWEL_CONTAINER\$'; then
  docker rm -f $SHADOW_SOWEL_CONTAINER
fi

docker run -d --name $SHADOW_SOWEL_CONTAINER \\
  --network $SHADOW_NETWORK \\
  -p $SHADOW_PORT:3000 \\
  -v $data_dir/data:/app/data \\
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
  : "${TARGET:=local}"
  assert_clean_repo
  assert_prod_running
  assert_no_target_conflict

  local tag
  tag=$(current_image_tag)

  echo
  log "Deploying shadow stack — target=$TARGET"
  log "Branch: $(git -C "$REPO_ROOT" branch --show-current) @ $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  log "Image:  $tag"
  log "URL:    $(target_url)"
  log "Data:   $(target_data_dir)"
  echo

  build_image "$tag"
  transfer_image_to_sowelox "$tag"   # no-op when target=local
  target_ensure_network
  target_ensure_dirs
  target_ensure_influx
  target_recreate_sowel "$tag"

  write_target_state

  echo
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN} ✓ Shadow deployed (target=$TARGET)${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  if [[ "$TARGET" == "sowelox" ]]; then
    echo "  Prod    : http://192.168.0.230:3000 (untouched)"
  fi
  echo "  Shadow  : $(target_url) (SOWEL_SHADOW_MODE=1)"
  echo "  Image   : $tag"
  echo "  Data    : $(target_data_dir)/data"
  echo "  Influx  : $SHADOW_INFLUX_CONTAINER (port not exposed)"
  echo
  echo "  Daily start/stop: ./scripts/run-swap.sh shadow {start|stop}"
  echo "  Restore         : open the shadow UI, Admin > Backup > Restore"
  echo "                    with a backup downloaded from the prod UI"
  echo "  Tear down       : $0 down"
  echo "  Destroy data    : $0 destroy"
  echo
}

cmd_down() {
  resolved_target_or_die
  echo
  log "Tearing down shadow stack — target=$TARGET (data dir preserved)"
  echo

  cat <<EOF | run_on_target
set -euo pipefail
docker rm -f $SHADOW_SOWEL_CONTAINER 2>/dev/null || true
docker rm -f $SHADOW_INFLUX_CONTAINER 2>/dev/null || true
docker network rm $SHADOW_NETWORK 2>/dev/null || true
if [[ -d "$(target_data_dir)" ]]; then
  echo "Shadow data dir kept at $(target_data_dir). Remove with: $0 destroy"
fi
EOF

  clear_target_state
  ok "Shadow torn down"
}

cmd_destroy() {
  resolved_target_or_die

  warn "This will delete $(target_data_dir)/ on target=$TARGET (data + influx)."
  warn "IRREVERSIBLE."
  confirm "Proceed?" || { log "Aborted."; exit 0; }

  cmd_down

  log "Deleting $(target_data_dir) on target=$TARGET..."
  local sudo_prefix
  sudo_prefix=$(target_mkdir_prefix)
  cat <<EOF | run_on_target
set -euo pipefail
${sudo_prefix}rm -rf $(target_data_dir)
EOF
  ok "Shadow data dir removed"
}

cmd_status() {
  resolved_target_or_die
  echo
  log "Shadow deployment state — target=$TARGET"
  echo

  local data_dir
  data_dir=$(target_data_dir)
  cat <<EOF | run_on_target
echo "--- containers ---"
docker ps -a --filter 'name=$SHADOW_SOWEL_CONTAINER' --filter 'name=$SHADOW_INFLUX_CONTAINER' \\
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true
echo "--- network ---"
docker network ls --filter 'name=$SHADOW_NETWORK' --format '{{.Name}}' || true
echo "--- data dir ---"
if [[ -d "$data_dir" ]]; then
  du -sh "$data_dir/data" "$data_dir/influx" 2>/dev/null || ls -la "$data_dir"
else
  echo "($data_dir does not exist)"
fi
EOF
  echo
}

# ------------------------------------------------------------
# Arg parsing
# ------------------------------------------------------------

CMD=""
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target=*)
      TARGET="${1#*=}"
      shift
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    up|update|down|destroy|status)
      CMD="$1"
      shift
      ;;
    -h|--help|"")
      CMD="help"
      shift || true
      ;;
    *)
      err "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ -n "$TARGET" && "$TARGET" != "local" && "$TARGET" != "sowelox" ]]; then
  err "Invalid --target: $TARGET (expected: local | sowelox)"
  exit 1
fi

case "$CMD" in
  up|update) cmd_up ;;
  down)      cmd_down ;;
  destroy)   cmd_destroy ;;
  status)    cmd_status ;;
  help|"")
    echo "Usage: $0 {up|update|down|destroy|status} [--target=local|sowelox]"
    echo
    echo "  up       Build current branch, create+start the shadow stack (default --target=local)"
    echo "  update   Alias for up (rebuild + recreate sowel-shadow with the new image)"
    echo "  down     Stop and remove the shadow containers + network. Keep data dir."
    echo "  destroy  down + delete the data dir. IRREVERSIBLE."
    echo "  status   Print containers + network + data dir state"
    echo
    echo "Targets:"
    echo "  --target=local     Mac (Docker Desktop), http://localhost:3001 (default)"
    echo "  --target=sowelox   side-by-side with prod, http://192.168.0.230:3001"
    echo
    echo "Daily start/stop after deployment: ./scripts/run-swap.sh shadow {start|stop}"
    echo
    exit 0
    ;;
esac
