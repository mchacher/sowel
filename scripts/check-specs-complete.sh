#!/usr/bin/env bash
#
# Specs completeness gate (see the sowel-feature skill).
#
# A NEW spec folder marks a new feature, and a feature's folder must carry the
# three documents the workflow produces:
#   spec.md · architecture.md · plan.md
#
# This check fails a PR only when it CREATES a new specs/<NNN-name>/ folder that
# is missing one of the three. It deliberately ignores PRs that merely add files
# to an existing spec folder (issue fixes, follow-up notes, review screenshots),
# and never retro-fails the historical specs that predate this rule.
#
# Runs in CI (pull_request) and locally: `bash scripts/check-specs-complete.sh`.
# Portable to bash 3.2 (macOS) — no mapfile / associative arrays.

set -euo pipefail

BASE_REF="${1:-origin/main}"

# Make sure the base ref is available (CI shallow clones).
if ! git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
  git fetch --quiet origin main
  BASE_REF="origin/main"
fi

BASE="$(git merge-base "${BASE_REF}" HEAD)"

# Spec folders that exist now but did NOT exist at the merge base = folders this
# PR creates. Robust to how the files were added (plain add or rename).
base_dirs="$(git ls-tree -d --name-only "${BASE}" -- specs/ 2>/dev/null || true)"

new_dirs=""
for dir in $(git ls-tree -d --name-only HEAD -- specs/); do
  if printf '%s\n' "${base_dirs}" | grep -qxF "${dir}"; then
    continue # folder already existed — not a new feature spec
  fi
  new_dirs="${new_dirs} ${dir}"
done

if [ -z "${new_dirs}" ]; then
  echo "No new spec folder in this PR — specs completeness check skipped."
  exit 0
fi

failed=0
for dir in ${new_dirs}; do
  missing=""
  for f in spec.md architecture.md plan.md; do
    [ -f "${dir}/${f}" ] || missing="${missing} ${f}"
  done
  if [ -n "${missing}" ]; then
    echo "❌ new spec ${dir} is missing:${missing}"
    failed=1
  else
    echo "✓ ${dir}"
  fi
done

if [ "${failed}" -ne 0 ]; then
  echo
  echo "A new spec folder must contain spec.md, architecture.md and plan.md."
  echo "Use the sowel-feature workflow so all three are produced together."
  echo "(Issue fixes and follow-ups that touch an existing spec are not gated.)"
  exit 1
fi

echo "All new spec folders are complete."
