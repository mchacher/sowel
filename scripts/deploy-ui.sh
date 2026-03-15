#!/usr/bin/env bash
# Build the UI and deploy to ui-dist/
# Usage: ./scripts/deploy-ui.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
UI_DIR="$ROOT_DIR/ui"
DIST_DIR="$ROOT_DIR/ui-dist"

echo "Building UI..."
cd "$UI_DIR"
npm run build

echo "Deploying to $DIST_DIR..."
rm -rf "$DIST_DIR"
cp -r "$UI_DIR/dist" "$DIST_DIR"

echo "Done! $(find "$DIST_DIR" -type f | wc -l | tr -d ' ') files deployed to ui-dist/"
