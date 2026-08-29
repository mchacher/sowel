#!/usr/bin/env bash
#
# Source area → likely documentation page (spec 167, R3).
#
# ADVISORY ONLY. This never fails a build, and that is deliberate. A blocking
# check built on an inexhaustive mapping is exactly where an escape hatch
# becomes the default path: the false positives train the author to reach for
# it, and the gate stops meaning anything. Heuristics inform, mechanics enforce.
#
# Its job is to turn "did you think about the documentation" into "this page
# probably needs a look", which is harder to dismiss and easier to act on.
#
# The map below is data. Extending it is a one-line change and carries no risk
# of failing a build, so add a row whenever drift shows up somewhere new.
#
# Sourced by check-docs-impact.sh; also runnable on its own:
#   bash scripts/docs-impact-map.sh
#
# Portable to bash 3.2 (macOS) — no mapfile / associative arrays.

set -euo pipefail

# One row per line: "<source prefix>|<comma-separated likely pages>"
# Longest-prefix wins is NOT implemented on purpose — a file matching several
# rows should surface all of them.
DOCS_IMPACT_MAP='
ui/src/components/equipments/|docs/user/equipments.md
ui/src/components/energy/|docs/user/energy.md, docs/deep-dives/energy-tour.md, docs/deep-dives/surplus-arbiter.md
ui/src/components/plugins/|docs/user/plugins.md
ui/src/components/dashboard/|docs/user/dashboard.md
ui/src/pages/|docs/user/
src/shared/types.ts|docs/technical/data-model.md, docs/technical/api-reference.md
src/api/routes/|docs/technical/api-reference.md
src/api/websocket.ts|docs/technical/api-reference.md
src/shared/plugin-api.ts|docs/technical/plugin-development.md
src/plugins/|docs/technical/plugin-development.md
src/packages/|docs/technical/plugin-development.md
src/recipes/|docs/technical/recipe-development.md
src/energy/|docs/deep-dives/surplus-arbiter.md, docs/user/energy.md
src/devices/|docs/technical/data-model/devices.md
src/equipments/|docs/technical/data-model/equipments.md
src/zones/|docs/technical/data-model/zones.md
src/modes/|docs/technical/data-model/modes.md
src/auth/|docs/technical/api-reference.md
migrations/|docs/technical/data-model/
Dockerfile|docs/technical/deployment.md
docker-compose.yml|docs/technical/deployment.md
.github/dependabot.yml|docs/technical/dependency-management.md
'

# Print the likely pages for the given changed files, one annotation per match.
# Never exits non-zero.
docs_impact_hints() {
  local changed="$1"
  local hinted=""

  printf '%s\n' "${DOCS_IMPACT_MAP}" | while IFS='|' read -r prefix pages; do
    [ -n "${prefix}" ] || continue
    if printf '%s\n' "${changed}" | grep -q "^${prefix}"; then
      echo "  ${prefix} → ${pages}"
    fi
  done
}

# Standalone invocation: hint against the working diff.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  BASE_REF="${1:-origin/main}"
  if ! git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
    git fetch --quiet origin main
    BASE_REF="origin/main"
  fi
  BASE="$(git merge-base "${BASE_REF}" HEAD)"
  changed="$(git diff --name-only "${BASE}" HEAD || true)"
  hints="$(docs_impact_hints "${changed}")"
  if [ -n "${hints}" ]; then
    echo "Documentation pages likely affected by this change:"
    echo "${hints}"
  else
    echo "No mapped source area touched."
  fi
fi
