#!/usr/bin/env bash
#
# Registry bump integrity gate (spec 089, issue #892).
#
# A `plugins/registry.json` entry says: this version of this plugin is that
# tarball, and its SHA256 is this. Get the pair wrong and the install flow
# refuses the download on every instance with a ChecksumMismatchError, about an
# hour later, once the CDN has propagated the file. Nothing checked it: a
# registry-only PR ran lint, typecheck, build and CodeQL, none of which can see
# a stale hash.
#
# So this fails a PR whose registry change does not match what GitHub actually
# publishes. It only looks at entries the PR touches, so a PR that leaves the
# registry alone costs one `git diff` and exits.
#
# Checked, per changed entry:
#   1. the release v<version> exists on <repo> and carries the expected asset
#   2. the asset's SHA256 equals the entry's `sha256`
#   3. the manifest.json inside the tarball declares the same id and version
#      — the hash can be right while the entry points at the wrong release
#
# Plus a shape pass over the WHOLE file (sha256 is 64 hex, repo/version/owner
# present), because spec 089 refuses to install an entry missing either field
# and that is worth catching whether or not this PR touched it.
#
# Runs in CI (pull_request) and locally:
#   bash scripts/check-registry-bump.sh
# The download step needs `gh` authenticated (read access to public releases is
# enough). The shape pass needs nothing.
#
# SOWEL_REGISTRY_ASSET_DIR reads the tarballs from a local directory instead of
# downloading them. The test suite uses it; nothing else should.
#
# Uses python3 for the JSON reads (jq is not guaranteed on a contributor's Mac).
# Portable to bash 3.2 (macOS) — no mapfile / associative arrays.

set -euo pipefail

REGISTRY="plugins/registry.json"
BASE_REF="${1:-origin/main}"
ASSET_DIR="${SOWEL_REGISTRY_ASSET_DIR:-}"

if [ ! -f "${REGISTRY}" ]; then
  echo "❌ ${REGISTRY} not found — run this from the repository root."
  exit 1
fi

# ── Shape (whole file) ──────────────────────────────────────────────────────

shape_errors="$(python3 - "${REGISTRY}" <<'PY'
import json, re, sys

try:
    entries = json.load(open(sys.argv[1]))
except json.JSONDecodeError as err:
    print(f"the file is not valid JSON: {err}")
    raise SystemExit(0)

for entry in entries:
    pid = entry.get("id") or "<entry with no id>"
    for field in ("repo", "version", "owner", "type"):
        if not entry.get(field):
            print(f"{pid}: missing {field}")
    if not re.fullmatch(r"[a-f0-9]{64}", entry.get("sha256") or ""):
        print(f"{pid}: sha256 is not 64 hex characters")
PY
)"

if [ -n "${shape_errors}" ]; then
  echo "❌ ${REGISTRY} breaks the spec 089 entry contract:"
  printf '%s\n' "${shape_errors}" | sed 's/^/   /'
  echo
  echo "Every entry needs repo, version, owner and a 64-hex sha256."
  echo "Fill a missing hash with: node scripts/backfill-registry-sha256.mjs"
  exit 1
fi

# ── Which entries does this PR change? ──────────────────────────────────────

if ! git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
  git fetch --quiet origin main
  BASE_REF="origin/main"
fi

BASE="$(git merge-base "${BASE_REF}" HEAD)"

if [ -z "$(git diff --name-only "${BASE}" HEAD -- "${REGISTRY}" || true)" ]; then
  echo "No registry change in this PR — bump integrity check skipped."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

# A registry that did not exist at the base (or a PR that creates it) means
# every entry is new, which is what an empty base gives us.
git show "${BASE}:${REGISTRY}" >"${TMP}/base.json" 2>/dev/null || echo '[]' >"${TMP}/base.json"

changed="$(python3 - "${TMP}/base.json" "${REGISTRY}" <<'PY'
import json, sys

base = {e.get("id"): e for e in json.load(open(sys.argv[1]))}
head = json.load(open(sys.argv[2]))

for entry in head:
    was = base.get(entry.get("id"))
    if was and was.get("version") == entry.get("version") and was.get("sha256") == entry.get("sha256"):
        continue  # untouched, or only its description/tags moved
    print("|".join([
        entry["id"], entry["type"], entry["repo"], entry["version"], entry["sha256"],
    ]))
PY
)"

if [ -z "${changed}" ]; then
  echo "Registry touched, but no version or sha256 changed — nothing to verify."
  exit 0
fi

# ── Verify each changed entry against its published release ─────────────────

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

failed=0

printf '%s\n' "${changed}" | while IFS='|' read -r id type repo version sha; do
  [ -n "${id}" ] || continue

  case "${type}" in
    recipe) asset="sowel-recipe-${id}-${version}.tar.gz" ;;
    *) asset="sowel-plugin-${id}-${version}.tar.gz" ;;
  esac

  if [ -n "${ASSET_DIR}" ]; then
    file="${ASSET_DIR}/${asset}"
    if [ ! -f "${file}" ]; then
      echo "❌ ${id} ${version}: ${asset} not found in ${ASSET_DIR}"
      echo "failed" >>"${TMP}/failures"
      continue
    fi
  else
    file="${TMP}/${asset}"
    if ! gh release download "v${version}" -R "${repo}" -p "${asset}" -D "${TMP}" --clobber >/dev/null 2>&1; then
      echo "❌ ${id} ${version}: ${repo} has no release v${version} carrying ${asset}"
      echo "   Publish the release first: the registry is the last step, not the first."
      echo "failed" >>"${TMP}/failures"
      continue
    fi
  fi

  actual="$(sha256_of "${file}")"
  if [ "${actual}" != "${sha}" ]; then
    echo "❌ ${id} ${version}: sha256 does not match the published asset"
    echo "   registry: ${sha}"
    echo "   asset:    ${actual}"
    echo "failed" >>"${TMP}/failures"
    continue
  fi

  manifest="$(tar -xzOf "${file}" manifest.json 2>/dev/null || true)"
  if [ -z "${manifest}" ]; then
    echo "❌ ${id} ${version}: no manifest.json at the root of ${asset}"
    echo "failed" >>"${TMP}/failures"
    continue
  fi

  mismatch="$(printf '%s' "${manifest}" | python3 -c '
import json, sys

manifest = json.load(sys.stdin)
want_id, want_version = sys.argv[1], sys.argv[2]
got_id = manifest.get("id")
got_version = manifest.get("version")
if got_id != want_id:
    print("manifest id is %r, registry says %r" % (got_id, want_id))
if got_version != want_version:
    print("manifest version is %r, registry says %r" % (got_version, want_version))
' "${id}" "${version}")"

  if [ -n "${mismatch}" ]; then
    echo "❌ ${id} ${version}: the tarball is not the release this entry claims"
    printf '%s\n' "${mismatch}" | sed 's/^/   /'
    echo "failed" >>"${TMP}/failures"
    continue
  fi

  echo "✓ ${id} ${version} — asset, hash and manifest agree"
done

if [ -f "${TMP}/failures" ]; then failed=1; fi

if [ "${failed}" -ne 0 ]; then
  echo
  echo "A wrong version/sha256 pair breaks the install on every instance once the"
  echo "registry propagates (spec 089). Re-run the backfill after the release is"
  echo "published: node scripts/backfill-registry-sha256.mjs"
  exit 1
fi

echo "Every changed registry entry matches its published release."
