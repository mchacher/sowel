#!/usr/bin/env bash
#
# Specs index completeness gate (spec 167, R4).
#
# docs/specs-index.md is what CLAUDE.md points at for "the full list of
# features ever shipped". It had drifted 42 rows short, and 18 shipped specs
# still read "Unreleased", some of them a year after shipping.
#
# Two assertions:
#   1. every specs/NNN-*/ folder has a row in the index
#   2. no spec still reads "Unreleased" once it is cited in a published
#      release-notes entry
#
# Release-scoped by nature, so it runs at the tag rather than per PR, in the
# verify-release-notes job that already gates every build.
#
# Runs in CI and locally: `bash scripts/check-specs-index.sh`
#
# Portable to bash 3.2 (macOS) — no mapfile / associative arrays.

set -euo pipefail

INDEX="docs/specs-index.md"
NOTES="docs/release-notes.md"

failed=0

# ── 1. A row per spec folder ──────────────────────────────────────────
missing=""
for dir in specs/*/; do
  [ -d "${dir}" ] || continue
  num="$(basename "${dir}" | cut -d- -f1)"
  if ! grep -qE "^\| ${num} \|" "${INDEX}"; then
    missing="${missing} ${num}"
  fi
done

if [ -n "${missing}" ]; then
  echo "❌ ${INDEX} has no row for:${missing}"
  failed=1
fi

# ── 2. Nothing shipped still reads "Unreleased" ───────────────────────
# A spec cited anywhere in release-notes.md has shipped, so its row cannot
# still claim otherwise.
stale=""
for num in $(grep -oE "^\| [0-9]{3} \|" "${INDEX}" | tr -d '| '); do
  grep -qE "^\| ${num} \|.*Unreleased" "${INDEX}" || continue
  if grep -qiE "spec ${num}\b" "${NOTES}"; then
    stale="${stale} ${num}"
  fi
done

if [ -n "${stale}" ]; then
  echo "❌ shipped but still marked Unreleased in ${INDEX}:${stale}"
  failed=1
fi

if [ "${failed}" -ne 0 ]; then
  echo
  echo "Add the missing rows, and replace 'Unreleased' with the version that"
  echo "shipped the spec. The oldest release-notes entry citing it is the one."
  exit 1
fi

echo "Specs index is complete and no shipped spec reads Unreleased ✓"
