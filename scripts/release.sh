#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Sowel Release Script
# Usage: scripts/release.sh <version>
# Example: scripts/release.sh 1.54.0
# ============================================================
#
# Branch protection blocks direct pushes to main, so a release ships in two
# steps:
#   1. A normal PR bumps the version in package.json + ui/package.json and adds
#      the release-notes entries (docs/release-notes.md + .fr.md), and is merged
#      to main.
#   2. This script tags that merged commit and pushes the tag, which triggers
#      the GitHub Actions release build.
#
# Run it on main, AFTER the release PR has been merged and pulled. It does not
# commit or push to main itself — it only validates and tags.

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  CURRENT=$(node -p "require('./package.json').version")
  echo "Usage: scripts/release.sh <version>"
  echo "Current version: $CURRENT"
  exit 1
fi

# Validate semver format
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: Invalid version format. Use semver (e.g., 1.54.0)"
  exit 1
fi

# Must be on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Error: Must be on main branch (currently on $BRANCH)"
  exit 1
fi

# Must have clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Local main must match origin/main (the release PR is merged and pulled)
git fetch origin main --quiet
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Error: local main is not in sync with origin/main. Pull first."
  exit 1
fi

# The version bump must already be merged (done by the release PR)
PKG=$(node -p "require('./package.json').version")
UIPKG=$(node -p "require('./ui/package.json').version")
if [ "$PKG" != "$VERSION" ] || [ "$UIPKG" != "$VERSION" ]; then
  echo "Error: package.json ($PKG) / ui/package.json ($UIPKG) are not at $VERSION."
  echo "Merge the release PR that bumps the version before tagging."
  exit 1
fi

# Release notes must carry the anchored entry in both languages (spec 108)
ANCHOR="{ #v$(echo "$VERSION" | tr . -) }"
for f in docs/release-notes.md docs/release-notes.fr.md; do
  if ! grep -qF "$ANCHOR" "$f"; then
    echo "Error: missing release-notes entry '$ANCHOR' in $f (spec 108)."
    exit 1
  fi
done

# Tag must not already exist
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Error: tag v$VERSION already exists."
  exit 1
fi

echo "Releasing Sowel v$VERSION on $(git rev-parse --short HEAD)"
echo ""

# Tag the merged commit and push the tag (this triggers the release build)
git tag "v$VERSION"
git push origin "v$VERSION"

echo ""
echo "Tagged v$VERSION and pushed."
echo "GitHub Actions will now build the Docker image and create the release."
echo ""
echo "Monitor: gh run list --limit 3"
