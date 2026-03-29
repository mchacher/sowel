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

- [ ] New repo `mchacher/sowel-plugin-panasonic-cc`
- [ ] Python bridge script included in tarball
- [ ] All features preserved: device discovery, AC control, polling
- [ ] Pre-built tarball release via GitHub Actions
- [ ] Added to `plugins/registry.json`
- [ ] Built-in code removed from `src/integrations/panasonic-cc/`
- [ ] No user-facing regression
