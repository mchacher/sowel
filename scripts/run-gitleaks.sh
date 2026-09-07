#!/usr/bin/env bash
# Spec/incident — run gitleaks against the working tree (staged changes
# by default) and report any leaked secret. Used by the husky pre-commit
# hook and runnable manually with `./scripts/run-gitleaks.sh full` for a
# whole-history scan.
#
# Tries the host `gitleaks` binary first (fastest), falls back to the
# Docker image `zricethezav/gitleaks:latest`. If neither is available,
# prints a hint and exits 0 — security is enforced again by the
# .github/workflows/gitleaks.yml CI job so the local hook is best-effort.
#
# The Docker branch asks the DAEMON, not the CLI. `command -v docker` is true
# on any machine where Docker Desktop is installed, including when it is not
# running, so the fallback ran `docker run`, failed to connect, and returned
# non-zero — turning "best-effort" into "no commit until you start Docker".
# `docker info` is the cheapest question that actually means "can I run a
# container right now".

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
MODE="${1:-protect}"   # protect | detect | full
EXTRA_ARGS="${*:2}"

cd "$REPO_ROOT"

run_local() {
  case "$MODE" in
    protect)
      gitleaks protect --staged --no-banner --redact --config=.gitleaks.toml $EXTRA_ARGS
      ;;
    detect|full)
      gitleaks detect --no-banner --redact --config=.gitleaks.toml $EXTRA_ARGS
      ;;
    *)
      echo "Usage: $0 [protect|detect|full] [extra args]" >&2
      exit 2
      ;;
  esac
}

run_docker() {
  case "$MODE" in
    protect)
      docker run --rm -v "$REPO_ROOT:/scan" zricethezav/gitleaks:latest \
        protect --source=/scan --staged --no-banner --redact \
        --config=/scan/.gitleaks.toml $EXTRA_ARGS
      ;;
    detect|full)
      docker run --rm -v "$REPO_ROOT:/scan" zricethezav/gitleaks:latest \
        detect --source=/scan --no-banner --redact \
        --config=/scan/.gitleaks.toml $EXTRA_ARGS
      ;;
    *)
      echo "Usage: $0 [protect|detect|full] [extra args]" >&2
      exit 2
      ;;
  esac
}

if command -v gitleaks >/dev/null 2>&1; then
  run_local
elif docker info >/dev/null 2>&1; then
  run_docker
else
  echo "gitleaks: neither the host binary nor Docker is available — skipping scan." >&2
  echo "Install gitleaks (\`brew install gitleaks\`) or Docker to enable local secret scanning." >&2
  echo "CI still runs gitleaks on every push and PR via .github/workflows/gitleaks.yml." >&2
  exit 0
fi
