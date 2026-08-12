#!/usr/bin/env bash
#
# Specs completeness gate (see the sowel-feature skill).
#
# Every spec folder MUST carry the three documents the workflow produces:
#   spec.md · architecture.md · plan.md
#
# This check fails a PR that ADDS any file under specs/<NNN-name>/ while that
# folder is still missing one of the three. It only looks at folders the PR
# touches with a *new* file, so it enforces completeness going forward without
# retro-failing the historical specs that predate this rule.
#
# Runs in CI (pull_request) and locally: `bash scripts/check-specs-complete.sh`.
# Portable to bash 3.2 (macOS) — no mapfile / associative arrays.

set -eu

BASE_REF="${1:-origin/main}"

# Make sure the base ref is available (CI shallow clones).
if ! git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
  git fetch --quiet origin main
  BASE_REF="origin/main"
fi

BASE="$(git merge-base "${BASE_REF}" HEAD)"

# Folders under specs/ that this PR adds at least one new file to.
touched="$(
  git diff --name-only --diff-filter=A "${BASE}" HEAD -- 'specs/*/*' \
    | sed -E 's#(specs/[^/]+)/.*#\1#' \
    | sort -u
)"

if [ -z "${touched}" ]; then
  echo "No new spec files in this PR — specs completeness check skipped."
  exit 0
fi

failed=0
while IFS= read -r dir; do
  [ -n "${dir}" ] || continue
  missing=""
  for f in spec.md architecture.md plan.md; do
    [ -f "${dir}/${f}" ] || missing="${missing} ${f}"
  done
  if [ -n "${missing}" ]; then
    echo "❌ ${dir} is missing:${missing}"
    failed=1
  else
    echo "✓ ${dir}"
  fi
done <<EOF
${touched}
EOF

if [ "${failed}" -ne 0 ]; then
  echo
  echo "Every spec folder must contain spec.md, architecture.md and plan.md."
  echo "Use the sowel-feature workflow so all three are produced together."
  exit 1
fi

echo "All touched spec folders are complete."
