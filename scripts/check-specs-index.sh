#!/usr/bin/env bash
#
# Specs index completeness gate (spec 167, R4).
#
# docs/specs-index.md is what CLAUDE.md points at for "the full list of
# features ever shipped". It had drifted 42 rows short, and 18 shipped specs
# still read "Unreleased", some of them a year after shipping.
#
# Two assertions, and they do NOT need the same context (issue #872):
#
#   folders  — every specs/NNN-*/ folder has exactly one row in each index,
#              EN and FR. Depends on the repository contents alone, so it runs
#              on the pull request, where the fix is one table row typed by the
#              author who already has the context.
#   released — nothing cited in release-notes.md still reads "Unreleased" in
#              the index. Needs the release notes to have been written, so it
#              stays at the tag.
#
# Placing `folders` at the tag cost two force-updated tags (v1.64.0, v1.65.0):
# a spec folder merged without its row failed nothing until someone cut a
# release, and the person who paid was not the person who could have fixed it
# for free.
#
# Usage:
#   bash scripts/check-specs-index.sh            # both (local one-shot)
#   bash scripts/check-specs-index.sh folders    # pull-request gate
#   bash scripts/check-specs-index.sh released   # release gate
#
# `Documentation currency` is not in the branch ruleset, so the CI step alone
# advises rather than blocks. What blocks is the last case of
# src/tooling/check-specs-index.test.ts, which runs this script against the
# repository itself inside the required Backend job. That test is load-bearing:
# delete it and the folders assertion degrades to advisory.
#
# Portable to bash 3.2 (macOS) — no mapfile / associative arrays.

set -euo pipefail

MODE="${1:-all}"
case "${MODE}" in
  all | folders | released) ;;
  *)
    echo "usage: $(basename "$0") [all|folders|released]" >&2
    exit 2
    ;;
esac

# 048a / 048b / 048c exist, so a spec number is three digits plus an optional
# letter. Both assertions must agree on that, or one accepts a row the other
# cannot see.
ROW="^\| [0-9]{3}[a-z]? \|"

INDEX_EN="docs/specs-index.md"
INDEX_FR="docs/specs-index.fr.md"
NOTES="docs/release-notes.md"

failed=0

# A wrong cwd used to produce a grep error, a nonsense list of every spec, and
# the exit code reserved for a usage error.
require_file() {
  if [ ! -f "$1" ]; then
    echo "❌ $1 not found — run this from the repository root."
    exit 1
  fi
}

# ── 1. One row per spec folder, in both indexes ───────────────────────
# Both files carry the same table, so a fix that lands in the English index
# alone fails the next run one round trip later (observed on #871).
if [ "${MODE}" = "all" ] || [ "${MODE}" = "folders" ]; then
  require_file "${INDEX_EN}"
  require_file "${INDEX_FR}"

  # Spec folders resolved once, in pure shell. This used to call `basename` and
  # a `grep` per folder per index: 175 folders x 2 indexes x 2 processes is 700
  # spawns, ~13 s on macOS, which blew the 5 s timeout of the test that runs
  # this against the repository and so failed `npm run validate` and the
  # pre-push hook on a developer machine while CI stayed green. The work is a
  # set membership test; it does not need a process per element.
  spec_slugs=""
  for dir in specs/*/; do
    [ -d "${dir}" ] || continue
    slug="${dir%/}"
    slug="${slug##*/}"
    num="${slug%%-*}"
    case "${num}" in
      # 048a / 048b / 048c exist, hence the optional letter.
      [0-9][0-9][0-9] | [0-9][0-9][0-9][a-z]) ;;
      # Not a spec folder (no NNN- prefix): nothing to look up, and inviting
      # someone to paste `| archive | ... |` would be worse than staying quiet.
      *) continue ;;
    esac
    spec_slugs="${spec_slugs} ${slug}"
  done

  for index in "${INDEX_EN}" "${INDEX_FR}"; do
    # One pass over the index, reused by both assertions below.
    # `|| true`: grep exits 1 on an index with no rows at all, and pipefail
    # would then kill the script mid-check without printing anything.
    listed="$( { grep -oE "${ROW}" "${index}" || true; } | tr -d '| ' )"
    listed_flat=" $(echo "${listed}" | tr '\n' ' ') "

    missing=""
    for slug in ${spec_slugs}; do
      num="${slug%%-*}"
      case "${listed_flat}" in
        *" ${num} "*) ;;
        *) missing="${missing} ${slug}" ;;
      esac
    done

    if [ -n "${missing}" ]; then
      echo "❌ ${index} has no row for:"
      for slug in ${missing}; do
        num="${slug%%-*}"
        if [ "${index}" = "${INDEX_FR}" ]; then
          echo "   | ${num} | <titre> | ✅     | Livrée. Voir \`specs/${slug}/\`. |"
        else
          echo "   | ${num} | <title> | ✅     | Shipped. See \`specs/${slug}/\`. |"
        fi
      done
      failed=1
    fi

    # A row pasted twice is invisible to the membership test above, and it is
    # how the French index grew a second copy of specs 136-172 (#872).
    duplicated="$(echo "${listed}" | sort | uniq -d | tr '\n' ' ')"
    if [ -n "${duplicated}" ]; then
      echo "❌ ${index} lists the same spec more than once: ${duplicated}"
      failed=1
    fi
  done
fi

# ── 2. Nothing shipped still reads "Unreleased" ───────────────────────
# A spec cited anywhere in release-notes.md has shipped, so its row cannot
# still claim otherwise.
if [ "${MODE}" = "all" ] || [ "${MODE}" = "released" ]; then
  require_file "${INDEX_EN}"
  require_file "${NOTES}"

  stale=""
  for num in $( { grep -oE "${ROW}" "${INDEX_EN}" || true; } | tr -d '| '); do
    grep -qE "^\| ${num} \|.*Unreleased" "${INDEX_EN}" || continue
    if grep -qiE "spec ${num}\b" "${NOTES}"; then
      stale="${stale} ${num}"
    fi
  done

  if [ -n "${stale}" ]; then
    echo "❌ shipped but still marked Unreleased in ${INDEX_EN}:${stale}"
    failed=1
  fi
fi

if [ "${failed}" -ne 0 ]; then
  echo
  echo "Add the missing rows to BOTH indexes, and replace 'Unreleased' with the"
  echo "version that shipped the spec. The oldest release-notes entry citing it"
  echo "is the one."
  exit 1
fi

case "${MODE}" in
  folders) echo "Every spec folder has a row in both indexes ✓" ;;
  released) echo "No shipped spec reads Unreleased ✓" ;;
  all) echo "Specs index is complete and no shipped spec reads Unreleased ✓" ;;
esac
