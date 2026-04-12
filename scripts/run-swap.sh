#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Sowel dev/prod swap script
# ============================================================
#
# Swaps between:
#   - Local dev mode:   npm run dev on the Mac (backend + UI)
#                       + prod sowel container stopped on sowelox
#   - Remote prod mode: sowel container running on sowelox
#                       + local npm dev processes stopped
#
# Usage:
#   ./scripts/run-swap.sh local    # swap to local dev
#   ./scripts/run-swap.sh remote   # swap to remote prod
#   ./scripts/run-swap.sh stop     # stop everything (local + remote)
#   ./scripts/run-swap.sh status   # show current state
#
# Notes:
# - Local dev uses a dedicated SQLite DB: ./data/sowel.dev.db (isolated from prod)
# - Backend runs on :3000, Vite UI dev server on :5173
# - Logs go to /tmp/sowel-dev-{backend,ui}.log
# - PIDs tracked in /tmp/sowel-dev-{backend,ui}.pid
# ============================================================

SOWELOX_HOST="mchacher@192.168.0.230"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PID_FILE="/tmp/sowel-dev-backend.pid"
UI_PID_FILE="/tmp/sowel-dev-ui.pid"
BACKEND_LOG="/tmp/sowel-dev-backend.log"
UI_LOG="/tmp/sowel-dev-ui.log"
DEV_DB="$REPO_ROOT/data/sowel.dev.db"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}→${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1" >&2; }

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

is_running() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] || return 1
  local pid
  pid=$(cat "$pidfile" 2>/dev/null || echo "")
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

kill_pidfile() {
  local pidfile="$1"
  local name="$2"
  if is_running "$pidfile"; then
    local pid
    pid=$(cat "$pidfile")
    log "Killing $name (pid $pid)..."
    # Kill the process and its children (npm spawns tsx which spawns node)
    pkill -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      warn "$name did not exit on SIGTERM, forcing SIGKILL"
      pkill -9 -P "$pid" 2>/dev/null || true
      kill -9 "$pid" 2>/dev/null || true
    fi
  else
    log "$name not running (no PID file or stale)"
  fi
  rm -f "$pidfile"
}

sowelox_sowel_running() {
  ssh -o ConnectTimeout=5 "$SOWELOX_HOST" \
    "docker ps --format '{{.Names}}' | grep -q '^sowel$'" 2>/dev/null
}

# ------------------------------------------------------------
# Commands
# ------------------------------------------------------------

cmd_local() {
  echo
  log "Swapping to local dev mode"
  echo

  # 1. Stop remote sowel
  if sowelox_sowel_running; then
    log "Stopping sowel container on sowelox..."
    ssh "$SOWELOX_HOST" "docker stop sowel" > /dev/null
    ok "Remote sowel stopped"
  else
    warn "Remote sowel already stopped"
  fi

  # 2. Kill any stale local processes
  if is_running "$BACKEND_PID_FILE" || is_running "$UI_PID_FILE"; then
    warn "Local dev processes already running — stopping them first"
    kill_pidfile "$BACKEND_PID_FILE" "backend"
    kill_pidfile "$UI_PID_FILE" "UI"
  fi

  # 3. Prepare dev DB path (does not create — backend will)
  mkdir -p "$REPO_ROOT/data"
  log "Dev DB: $DEV_DB"

  # 4. Start backend with dev DB and current TZ env var from host
  log "Starting backend (npm run dev)..."
  cd "$REPO_ROOT"
  # Note: do NOT set TZ here — we want to test the auto-detection path.
  # If the host has TZ set, it will flow through naturally.
  SQLITE_PATH="$DEV_DB" NODE_ENV=development nohup npm run dev \
    > "$BACKEND_LOG" 2>&1 &
  local backend_pid=$!
  echo "$backend_pid" > "$BACKEND_PID_FILE"
  ok "Backend started (pid $backend_pid, log: $BACKEND_LOG)"

  # 5. Start UI dev server
  log "Starting UI (vite dev server)..."
  cd "$REPO_ROOT/ui"
  nohup npm run dev > "$UI_LOG" 2>&1 &
  local ui_pid=$!
  echo "$ui_pid" > "$UI_PID_FILE"
  ok "UI started (pid $ui_pid, log: $UI_LOG)"

  echo
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN} ✓ Local dev mode active${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo "  Backend API: http://localhost:3000"
  echo "  Vite UI dev: http://localhost:5173"
  echo
  echo "  Backend log: tail -f $BACKEND_LOG"
  echo "  UI log     : tail -f $UI_LOG"
  echo
  echo "  When done  : $0 remote"
  echo
}

cmd_remote() {
  echo
  log "Swapping to remote prod mode"
  echo

  # 1. Kill local processes
  kill_pidfile "$BACKEND_PID_FILE" "backend"
  kill_pidfile "$UI_PID_FILE" "UI"

  # 2. Start remote sowel
  if sowelox_sowel_running; then
    warn "Remote sowel already running"
  else
    log "Starting sowel container on sowelox..."
    ssh "$SOWELOX_HOST" "docker start sowel" > /dev/null
    # Give it a moment to come up
    sleep 3
    if sowelox_sowel_running; then
      ok "Remote sowel started"
    else
      err "Remote sowel did not start — check 'docker logs sowel' on sowelox"
      exit 1
    fi
  fi

  echo
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN} ✓ Remote prod mode active${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo "  Sowel: http://192.168.0.230:3000"
  echo "  Also : https://app.sowel.org"
  echo
}

cmd_stop() {
  echo
  log "Stopping everything (local + remote)"
  echo

  # 1. Kill local processes
  kill_pidfile "$BACKEND_PID_FILE" "backend"
  kill_pidfile "$UI_PID_FILE" "UI"

  # 2. Stop remote sowel
  if sowelox_sowel_running; then
    log "Stopping sowel container on sowelox..."
    ssh "$SOWELOX_HOST" "docker stop sowel" > /dev/null
    ok "Remote sowel stopped"
  else
    warn "Remote sowel already stopped"
  fi

  echo
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN} ✓ Everything stopped${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo
}

cmd_status() {
  echo
  log "Current state"
  echo

  if sowelox_sowel_running; then
    ok "Remote sowel: running on sowelox"
  else
    warn "Remote sowel: stopped"
  fi

  if is_running "$BACKEND_PID_FILE"; then
    local pid
    pid=$(cat "$BACKEND_PID_FILE")
    ok "Local backend: running (pid $pid)"
  else
    warn "Local backend: not running"
  fi

  if is_running "$UI_PID_FILE"; then
    local pid
    pid=$(cat "$UI_PID_FILE")
    ok "Local UI: running (pid $pid)"
  else
    warn "Local UI: not running"
  fi
  echo
}

# ------------------------------------------------------------
# Entrypoint
# ------------------------------------------------------------

case "${1:-}" in
  local)  cmd_local ;;
  remote) cmd_remote ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  *)
    echo "Usage: $0 {local|remote|stop|status}"
    echo
    echo "  local   Swap to local dev mode (stop sowelox, start npm run dev on Mac)"
    echo "  remote  Swap to remote prod mode (stop local dev, start sowelox)"
    echo "  stop    Stop everything (local dev processes + sowelox container)"
    echo "  status  Show current state"
    echo
    exit 1
    ;;
esac
