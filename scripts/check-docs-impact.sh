#!/usr/bin/env bash
#
# Behaviour-change documentation gate (spec 167, R2).
#
# A `feat` or `fix` that touches src/ or ui/src/ changes something a reader can
# observe. Either the documentation moved with it, or somebody has to say why
# not — in a sentence, not a checkbox. The 2026-08-29 audit measured what the
# absence of this costs: the technical layer stayed maintained while the user
# guide silently lost six shipped equipment features.
#
# NOT gated: chore, refactor, test, docs, style, ci, build, perf. They change
# nothing a reader can observe, and gating them produces edits made to satisfy
# a gate, which is worse than no edit because it looks like maintenance.
#
# Waiving: put a trailer in the PR body. The reason is the load-bearing part and
# is required — a bare `Docs-Impact: none` fails.
#
#   Docs-Impact: none — internal refactor of the retry loop, no documented behaviour changes
#
# Runs in CI (pull_request, with PR_TITLE and PR_BODY set) and locally:
#   bash scripts/check-docs-impact.sh
# Locally PR_TITLE falls back to the last commit subject and PR_BODY is empty,
# so the local run is the strict case.
#
# Portable to bash 3.2 (macOS) — no mapfile / associative arrays.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/docs-impact-map.sh
. "${SCRIPT_DIR}/docs-impact-map.sh"

BASE_REF="${1:-origin/main}"
PR_BODY="${PR_BODY:-}"
PR_TITLE="${PR_TITLE:-$(git log -1 --pretty=%s)}"

if ! git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
  git fetch --quiet origin main
  BASE_REF="origin/main"
fi

BASE="$(git merge-base "${BASE_REF}" HEAD)"
changed="$(git diff --name-only "${BASE}" HEAD || true)"

# ── Does this PR claim to change observable behaviour? ────────────────
if ! printf '%s' "${PR_TITLE}" | grep -qE '^(feat|fix)(\([^)]*\))?!?:'; then
  echo "Not a feat/fix title (${PR_TITLE}) — documentation impact check skipped."
  exit 0
fi

if ! printf '%s\n' "${changed}" | grep -qE '^(src/|ui/src/)'; then
  echo "No src/ or ui/src/ change — documentation impact check skipped."
  exit 0
fi

# ── Surface the likely pages either way (advisory, never fails) ───────
hints="$(docs_impact_hints "${changed}")"
if [ -n "${hints}" ]; then
  echo "Documentation pages likely affected by this change:"
  echo "${hints}"
  echo
fi

# ── Satisfied by a documentation change ───────────────────────────────
if printf '%s\n' "${changed}" | grep -q '^docs/'; then
  echo "Documentation changed alongside the code ✓"
  exit 0
fi

# ── Or by a trailer carrying an actual reason ──────────────────────────
# Accept `-`, `--` or `—` as the separator, any case, flexible spacing. A gate
# that fails on punctuation teaches people to distrust it.
reason="$(
  printf '%s\n' "${PR_BODY}" \
    | grep -iE '^[[:space:]]*docs-impact:' \
    | head -1 \
    | sed -E 's/^[[:space:]]*[Dd][Oo][Cc][Ss]-[Ii][Mm][Pp][Aa][Cc][Tt]:[[:space:]]*//' \
    | sed -E 's/^(none|aucun|aucune|n\/a)[[:space:]]*(—|--|-|:)?[[:space:]]*//I' \
    | sed -E 's/[[:space:]]*$//' \
    || true
)"

if [ -n "${reason}" ]; then
  echo "No documentation change, waived by Docs-Impact ✓"
  echo "  reason: ${reason}"
  exit 0
fi

echo "❌ This ${PR_TITLE%%:*} touches src/ or ui/src/ but no documentation page."
echo
echo "Either update the relevant page, or state why none is needed with a"
echo "trailer in the PR body:"
echo
echo "  Docs-Impact: none — <why no reader-visible behaviour changed>"
echo
echo "The reason is required: a bare 'Docs-Impact: none' does not pass."
exit 1
