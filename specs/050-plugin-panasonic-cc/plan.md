# Implementation Plan: 050 — Panasonic CC Plugin

## Tasks

1. [ ] Create GitHub repo + scaffold plugin
2. [ ] Port all TS files + bridge.py to plugin
3. [ ] Adapt bridge path to use pluginDir instead of \_\_dirname
4. [ ] Include bridge.py in tarball (release workflow)
5. [ ] Remove src/integrations/panasonic-cc/ + registration
6. [ ] TypeScript + tests + lint
7. [ ] Tag + release + test (plugin install + AC control)

## Notes

- No migration needed: plugin uses same ID `panasonic_cc`
- bridge.py must be in plugin root (alongside dist/ and manifest.json)
- Release workflow includes bridge.py in tarball
- Token file `data/panasonic-tokens.json` stays in data/ dir
