# 048 — Externalize Netatmo HC as Plugin

## Summary

Migrate the Netatmo Home+Control integration from `src/integrations/netatmo-hc/` to an external plugin `sowel-plugin-netatmo-hc`. First integration to migrate — chosen because it has no exotic dependencies (only native fetch + OAuth token file).

## Current State

- Location: `src/integrations/netatmo-hc/`
- Files: `index.ts`, `netatmo-bridge.ts`, `netatmo-poller.ts`, `netatmo-weather-poller.ts`, `energy-backfill.ts`, `energy-backfill-today.ts`
- Dependencies: native fetch (no npm deps)
- State: OAuth tokens in `data/netatmo-tokens.json`, settings in `settings` table
- Features: Home+Control devices, Weather station, Energy polling

## Acceptance Criteria

- [ ] New repo `mchacher/sowel-plugin-netatmo-hc`
- [ ] Plugin implements `IntegrationPlugin` via `createPlugin(deps)`
- [ ] All features preserved: device discovery, orders, weather, energy polling
- [ ] OAuth token file (`data/netatmo-tokens.json`) read/written by plugin
- [ ] Settings keys unchanged (`integration.netatmo_hc.*`)
- [ ] Pre-built tarball release via GitHub Actions
- [ ] Added to `plugins/registry.json`
- [ ] Built-in code removed from `src/integrations/netatmo-hc/`
- [ ] No user-facing regression
