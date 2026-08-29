#!/usr/bin/env bash
#
# EN/FR documentation parity gate (spec 167, R1).
#
# Most pages under docs/ exist as a pair: `x.md` and `x.fr.md`. Nothing checked
# that a change to one reached the other, and the 2026-08-29 audit found the
# result: five API surfaces documented in English only, the whole capacity-claim
# chapter missing from the French recipe guide, and a French architecture page
# describing an auth middleware that had been replaced.
#
# This check fails a PR that touches one side of a pair without the other. It is
# silent when the counterpart does not exist (a page with no translation, or a
# page being created), because demanding a translation at creation time pushes
# authors to write neither.
#
# Waiving: put a trailer in the PR body naming the file and a reason.
#
#   Docs-Parity: docs/technical/api-reference.fr.md — typo fix in the EN copy only
#
# Runs in CI (pull_request, with PR_BODY set) and locally:
#   bash scripts/check-docs-parity.sh
# Locally PR_BODY is empty, so the local run is the strict case: it never passes
# on a trailer the runner would have seen.
#
# Portable to bash 3.2 (macOS) — no mapfile / associative arrays.

set -euo pipefail

BASE_REF="${1:-origin/main}"
PR_BODY="${PR_BODY:-}"

if ! git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
  git fetch --quiet origin main
  BASE_REF="origin/main"
fi

BASE="$(git merge-base "${BASE_REF}" HEAD)"

changed="$(git diff --name-only "${BASE}" HEAD -- 'docs/*.md' 'docs/**/*.md' || true)"

if [ -z "${changed}" ]; then
  echo "No documentation page touched — parity check skipped."
  exit 0
fi

# Is $1 present in the changed set?
is_changed() {
  printf '%s\n' "${changed}" | grep -qxF "$1"
}

# Does the PR body waive the missing counterpart $1?
is_waived() {
  [ -n "${PR_BODY}" ] || return 1
  printf '%s\n' "${PR_BODY}" \
    | tr '[:upper:]' '[:lower:]' \
    | grep -q "docs-parity:.*$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
}

failed=0
for f in ${changed}; do
  case "${f}" in
    *.fr.md) counterpart="${f%.fr.md}.md" ;;
    *.md) counterpart="${f%.md}.fr.md" ;;
    *) continue ;;
  esac

  # No counterpart in the tree: a page with no translation, or one being
  # created. Not a divergence.
  [ -f "${counterpart}" ] || continue

  is_changed "${counterpart}" && continue

  if is_waived "${counterpart}"; then
    echo "~ ${f} changed without ${counterpart} (waived by Docs-Parity)"
    continue
  fi

  echo "❌ ${f} changed but ${counterpart} did not"
  failed=1
done

if [ "${failed}" -ne 0 ]; then
  echo
  echo "Documentation pages come in EN/FR pairs. Update both, or state why not"
  echo "with a trailer in the PR body:"
  echo
  echo "  Docs-Parity: <the untouched file> — <reason>"
  exit 1
fi

echo "EN/FR parity holds for every page touched."
