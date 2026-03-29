# 048c — Externalize Legrand Energy as Plugin

## Summary

Extract the energy monitoring from the built-in Netatmo HC integration into an external plugin `sowel-plugin-legrand-energy`. Polls bridge-level energy data (getmeasure API), emits energy events for the history pipeline. Requires extending `PluginDeps` with `InfluxClient` for energy backfill.

## Current State

- Energy polling in `netatmo-poller.ts` (method: `pollEnergy()`, ~100 lines)
- Energy backfill scripts: `energy-backfill.ts`, `energy-backfill-today.ts`
- Uses `bridgeId` discovered from NLPC meter modules
- Emits energy data via `equipmentManager` for HP/HC classification
- Integration ID: `netatmo_hc`
- Activated by setting `enable_energy = true`

## Acceptance Criteria

- [ ] New repo `mchacher/sowel-plugin-legrand-energy`
- [ ] Polls getmeasure API for bridge-level energy (30-min windows)
- [ ] Discovers energy meters as devices
- [ ] Emits energy data events for history pipeline
- [ ] Energy backfill on first start (6 months historical)
- [ ] OAuth authentication with token rotation
- [ ] Integration ID: `legrand_energy`
- [ ] Settings prefix: `integration.legrand_energy.*`
- [ ] Token file: `data/legrand-energy-tokens.json`
- [ ] Pre-built tarball release via GitHub Actions
- [ ] Added to `plugins/registry.json`
- [ ] `PluginDeps` extended with `InfluxClient` (if needed for backfill)

## Open Questions

- Does energy polling need the `bridgeId` from Home+Control discovery? If yes, the Energy plugin needs its own module discovery or a config setting for bridge ID.
- Should energy backfill scripts stay in Sowel core as maintenance tools, or move into the plugin?
- Does `PluginDeps` need `InfluxClient` and `EquipmentManager`?

## Dependencies

- Depends on 048b (Legrand Control) being done first, to understand the bridge/meter discovery split
