# 050 — Externalize Panasonic CC as Plugin

## Summary

Migrate the Panasonic Comfort Cloud integration from `src/integrations/panasonic-cc/` to an external plugin `sowel-plugin-panasonic-cc`.

## Current State

- Location: `src/integrations/panasonic-cc/`
- Files: `index.ts`, `panasonic-bridge.ts`, `panasonic-poller.ts`
- Dependencies: Python bridge (`pcomfortcloud` subprocess)
- State: OAuth tokens in `data/panasonic-tokens.json`, settings in `settings` table
- Features: AC unit discovery, temperature/mode/fan orders via Python bridge

## Special Considerations

- Python bridge script must be included in the plugin tarball
- Plugin needs to spawn Python subprocess — host must have Python 3 installed
- Token file (`data/panasonic-tokens.json`) read/written by plugin

## Acceptance Criteria

- [x] New repo `mchacher/sowel-plugin-panasonic-cc`
- [x] Python bridge script (`bridge.py`) included in tarball
- [x] All features preserved: device discovery, AC control, polling
- [x] Pre-built tarball release via GitHub Actions (tarball includes bridge.py)
- [x] Added to `plugins/registry.json`
- [x] Built-in code removed from `src/integrations/panasonic-cc/`
- [x] Built-in registration removed from `src/index.ts`
- [x] No device migration needed (same integration ID `panasonic_cc`)
- [x] No user-facing regression (PAC equipment bindings intact, 10 bindings)
