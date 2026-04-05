#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Sowel Release Script
# Usage: scripts/release.sh <version>
# Example: scripts/release.sh 1.1.0
# ============================================================

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  CURRENT=$(node -p "require('./package.json').version")
  echo "Usage: scripts/release.sh <version>"
  echo "Current version: $CURRENT"
  exit 1
fi

# Validate semver format
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: Invalid version format. Use semver (e.g., 1.1.0)"
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

CURRENT=$(node -p "require('./package.json').version")
echo "Releasing Sowel v$VERSION (current: $CURRENT)"
echo ""

# Bump version in package.json and ui/package.json
node -e "
const fs = require('fs');
for (const file of ['package.json', 'ui/package.json']) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
  pkg.version = '$VERSION';
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log('  Updated', file, '→', '$VERSION');
}
"

# Commit
git add package.json ui/package.json
git commit -m "release: v$VERSION"

# Tag
git tag "v$VERSION"

# Push
echo ""
echo "Pushing to origin..."
git push origin main
git push origin "v$VERSION"

echo ""
echo "Release v$VERSION tagged and pushed."
echo "GitHub Actions will now build the Docker image and create the release."
echo ""
echo "Monitor: gh run list --limit 3"
