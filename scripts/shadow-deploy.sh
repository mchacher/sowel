#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Sowel shadow deployment lifecycle
# ============================================================
#
# Manages the candidate-image shadow stack — by default on the local
# Mac (Docker Desktop), or optionally on the prod host side-by-side with prod.
#
# Commands:
#   - up:      build current branch into a Docker image, create the
#              shadow-influx + sowel-shadow containers, start them with
#              SOWEL_SHADOW_MODE=1. Idempotent on network and Influx;
#              always recreates sowel-shadow so it picks up the latest
#              image. On --target=prod, also transfers the image
#              via docker save | ssh | docker load.
#   - update:  alias for `up`.
#   - down:    stop and remove the shadow containers + Docker network,
#              keep the data dir for post-mortem.
#   - destroy: down + delete the data dir. IRREVERSIBLE.
#   - status:  print what is deployed / running.
#
# Targets:
#   --target=local     Mac, http://localhost:3001 (default — per
#                      scripts/howto-shadow.md, shadow should
#                      run on a machine that is NOT the prod host).
#   --target=prod      side-by-side with prod on the prod host, port 3001
#
# Usage:
#   ./scripts/shadow-deploy.sh up                       # local (default)
#   ./scripts/shadow-deploy.sh up --target=local
#   ./scripts/shadow-deploy.sh up --target=prod
#   ./scripts/shadow-deploy.sh down
#   ./scripts/shadow-deploy.sh destroy
#   ./scripts/shadow-deploy.sh status
#
# After `up`, daily start/stop is handled by `run-swap.sh shadow`.
# The chosen target is persisted in data/.shadow-target so the toggle
# script knows which docker daemon to talk to.
#
# Safety:
# - Refuses to deploy with --target=prod if prod is not running.
# - Refuses to switch target while a shadow already exists (run `down`
#   or `destroy` first).
# - Refuses if the working tree is dirty (interactive bypass).
# - Image tag is local-only (sowel:shadow-<branch>-<sha>); never pushed.
# - On --target=prod, prod container is untouched (port 3000 stays).
#
# See scripts/howto-shadow.md for the playbook.
# ============================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Installation-specific hosts come from the private ops companion repo
# (see CLAUDE.md, section "Installation-specific context"). Default location
# is ../sowel-ops/ops.env next to this checkout; override with SOWEL_OPS_ENV.
# Template: scripts/ops.env.example
OPS_ENV="${SOWEL_OPS_ENV:-$REPO_ROOT/../sowel-ops/ops.env}"
if [[ -f "$OPS_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$OPS_ENV"
fi
SOWEL_PROD_SSH="${SOWEL_PROD_SSH:-}"   # e.g. user@prod-host
SOWEL_PROD_HOST="${SOWEL_PROD_HOST:-}" # e.g. prod-host:3000

require_prod_config() {
  if [[ -z "$SOWEL_PROD_SSH" || -z "$SOWEL_PROD_HOST" ]]; then
    echo "✗ SOWEL_PROD_SSH / SOWEL_PROD_HOST are not set." >&2
    echo "✗ Create ../sowel-ops/ops.env from scripts/ops.env.example (see CLAUDE.md," >&2
    echo "✗ section \"Installation-specific context\"), or export both variables." >&2
    exit 1
  fi
}
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
#   - prod:    pipe the heredoc through `ssh $SOWEL_PROD_SSH bash`
#
# Path of the host data dir, label, URL, and whether to require sudo
# for mkdir are all driven by $TARGET.

target_data_dir() {
  case "$TARGET" in
    local)   echo "$HOME/sowel-shadow" ;;
    prod) echo "/opt/sowel-shadow" ;;
  esac
}

target_url() {
  case "$TARGET" in
    local)   echo "http://localhost:$SHADOW_PORT" ;;
    prod)    echo "http://${SOWEL_PROD_HOST%%:*}:$SHADOW_PORT" ;;
  esac
}

target_mkdir_prefix() {
  # `/opt/...` requires sudo on the prod host; $HOME/... does not on the Mac.
  case "$TARGET" in
    local)   echo "" ;;
    prod) echo "sudo " ;;
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
    prod) ssh "$SOWEL_PROD_SSH" bash ;;
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
  [[ "$TARGET" == "prod" ]] || return 0
  if ! ssh -o ConnectTimeout=5 "$SOWEL_PROD_SSH" \
    "docker ps --format '{{.Names}}' | grep -q '^sowel\$'" 2>/dev/null; then
    err "Prod sowel container is not running on the prod host."
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
      # Legacy state files may contain the old target name for the prod host.
      [[ "$TARGET" == "sowelox" ]] && TARGET="prod"
    else
      err "No shadow target known (state file $TARGET_STATE_FILE missing)."
      err "Pass --target=local|prod explicitly."
      exit 1
    fi
  fi
  [[ "$TARGET" == "prod" ]] && require_prod_config
  return 0
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

transfer_image_to_prod() {
  local tag="$1"
  [[ "$TARGET" == "prod" ]] || return 0
  log "Transferring image to the prod host (docker save | gzip | ssh | gunzip | docker load)..."
  docker save "$tag" | gzip | ssh "$SOWEL_PROD_SSH" "gunzip | docker load"
  ok "Image loaded on the prod host"
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
  [[ "$TARGET" == "prod" ]] && require_prod_config
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
  transfer_image_to_prod "$tag"   # no-op when target=local
  target_ensure_network
  target_ensure_dirs
  target_ensure_influx
  target_recreate_sowel "$tag"

  write_target_state

  echo
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN} ✓ Shadow deployed (target=$TARGET)${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  if [[ "$TARGET" == "prod" ]]; then
    echo "  Prod    : http://$SOWEL_PROD_HOST (untouched)"
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

cmd_seed() {
  resolved_target_or_die
  require_prod_config   # seed always pulls the backup from prod

  local prod_host="$SOWEL_PROD_HOST"
  local prod_user="${SOWEL_PROD_USER:-admin}"
  local prod_password="${SOWEL_PROD_PASSWORD:-}"
  local prod_url="http://$prod_host"
  local shadow_url
  shadow_url=$(target_url)

  if [[ -z "$prod_password" ]]; then
    # Prompt without echoing the password. The script never logs it.
    read -r -s -p "Prod password for $prod_user@$prod_host: " prod_password
    echo
  fi

  echo
  log "Seeding shadow from prod"
  log "  Source : $prod_url ($prod_user)"
  log "  Target : $shadow_url (target=$TARGET)"
  echo

  # 1. Verify shadow is reachable (it should be up after `up` ran).
  if ! curl -sf -o /dev/null "$shadow_url/api/v1/auth/status"; then
    err "Shadow is not responding at $shadow_url"
    err "Start it first: ./scripts/run-swap.sh shadow"
    exit 1
  fi

  # 2. Login on prod. Use --data-raw with single quotes so `!` in the
  #    password is not expanded by bash.
  log "Authenticating on prod..."
  local prod_token
  prod_token=$(curl -sf -X POST "$prod_url/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    --data-raw '{"username":"'"$prod_user"'","password":"'"$prod_password"'"}' \
    | jq -r '.accessToken // empty')
  if [[ -z "$prod_token" ]]; then
    err "Failed to login on prod ($prod_url). Check credentials."
    exit 1
  fi
  ok "Prod auth OK"

  # 3. Download backup from prod.
  local backup_file
  backup_file=$(mktemp -t sowel-shadow-backup-XXXXXX.zip)
  log "Downloading backup from prod (this can take a minute)..."
  if ! curl -sf -o "$backup_file" -H "Authorization: Bearer $prod_token" \
       "$prod_url/api/v1/backup"; then
    err "Backup download failed."
    rm -f "$backup_file"
    exit 1
  fi
  ok "Backup saved ($(du -h "$backup_file" | cut -f1)) at $backup_file"

  # 4. Authenticate on shadow. First-run → POST /auth/setup; subsequent
  #    runs → POST /auth/login. We use the same prod creds in both cases
  #    so the shadow admin matches prod's admin (the restore would
  #    overwrite anything else anyway).
  local setup_required
  setup_required=$(curl -sf "$shadow_url/api/v1/auth/status" | jq -r '.setupRequired // false')

  local shadow_token
  if [[ "$setup_required" == "true" ]]; then
    log "Shadow first-run: creating admin..."
    shadow_token=$(curl -sf -X POST "$shadow_url/api/v1/auth/setup" \
      -H 'Content-Type: application/json' \
      --data-raw '{"username":"'"$prod_user"'","password":"'"$prod_password"'","displayName":"Shadow Admin"}' \
      | jq -r '.accessToken // empty')
  else
    log "Shadow already initialised, logging in..."
    shadow_token=$(curl -sf -X POST "$shadow_url/api/v1/auth/login" \
      -H 'Content-Type: application/json' \
      --data-raw '{"username":"'"$prod_user"'","password":"'"$prod_password"'"}' \
      | jq -r '.accessToken // empty')
  fi
  if [[ -z "$shadow_token" ]]; then
    err "Failed to authenticate on shadow."
    rm -f "$backup_file"
    exit 1
  fi
  ok "Shadow auth OK"

  # 5. Upload backup to shadow.
  log "Restoring backup on shadow..."
  local restore_response
  restore_response=$(curl -sf -X POST "$shadow_url/api/v1/backup" \
    -H "Authorization: Bearer $shadow_token" \
    -F "file=@$backup_file" || echo "")
  if [[ -z "$restore_response" ]]; then
    err "Restore failed. Backup kept at $backup_file for inspection."
    exit 1
  fi
  ok "Restore result: $restore_response"
  rm -f "$backup_file"

  # 6. Restart shadow container so plugins / aggregators pick up the
  #    restored DB. SOWEL_SHADOW_MODE=1 stays in the container env, so
  #    the inert invariant survives the restart.
  log "Restarting shadow container..."
  cat <<EOF | run_on_target
set -euo pipefail
docker restart $SHADOW_SOWEL_CONTAINER >/dev/null

# Wait up to 30s for the safety banner to reappear after restart.
for _ in {1..30}; do
  if docker logs --since 30s $SHADOW_SOWEL_CONTAINER 2>&1 | grep -q "SHADOW MODE ACTIVE"; then
    echo "Safety banner re-confirmed after restart."
    exit 0
  fi
  sleep 1
done
echo "WARNING: safety banner not observed after restart." >&2
docker logs --tail 30 $SHADOW_SOWEL_CONTAINER >&2
exit 1
EOF

  ok "Shadow seeded from prod and restarted"
  echo
  echo -e "${GREEN} → Open $shadow_url and log in with the prod admin.${NC}"
  echo
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
    up|update|down|destroy|status|seed)
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

# Legacy alias for the prod target (old state files / muscle memory).
[[ "$TARGET" == "sowelox" ]] && TARGET="prod"

if [[ -n "$TARGET" && "$TARGET" != "local" && "$TARGET" != "prod" ]]; then
  err "Invalid --target: $TARGET (expected: local | prod)"
  exit 1
fi

case "$CMD" in
  up|update) cmd_up ;;
  down)      cmd_down ;;
  destroy)   cmd_destroy ;;
  status)    cmd_status ;;
  seed)      cmd_seed ;;
  help|"")
    echo "Usage: $0 {up|update|down|destroy|status|seed} [--target=local|prod]"
    echo
    echo "  up       Build current branch, create+start the shadow stack (default --target=local)"
    echo "  update   Alias for up (rebuild + recreate sowel-shadow with the new image)"
    echo "  down     Stop and remove the shadow containers + network. Keep data dir."
    echo "  destroy  down + delete the data dir. IRREVERSIBLE."
    echo "  status   Print containers + network + data dir state"
    echo "  seed     Login on prod, download backup, restore on shadow, restart container."
    echo "           Reads SOWEL_PROD_HOST (from ../sowel-ops/ops.env),"
    echo "                 SOWEL_PROD_USER (default admin),"
    echo "                 SOWEL_PROD_PASSWORD (prompted if unset)."
    echo
    echo "Targets:"
    echo "  --target=local     Mac (Docker Desktop), http://localhost:3001 (default)"
    echo "  --target=prod      side-by-side with prod on the prod host, port 3001"
    echo
    echo "Typical flow: up → seed → open the URL → test"
    echo "Daily start/stop after deployment: ./scripts/run-swap.sh shadow {start|stop}"
    echo
    exit 0
    ;;
esac
