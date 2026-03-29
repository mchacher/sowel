# 048b — Externalize Legrand Control as Plugin

## Summary

Extract the Home+Control device management from the built-in Netatmo HC integration into an external plugin `sowel-plugin-legrand-control`. Full read/write plugin — discovers Legrand/Netatmo modules (lights, shutters, plugs), polls status, executes orders via setstate API.

## Current State

- Home+Control polling in `netatmo-poller.ts` (methods: `pollHomeControl()`)
- Order execution in `index.ts` (`executeOrder()`, `coerceValue()`)
- OAuth bridge in `netatmo-bridge.ts`
- Integration ID: `netatmo_hc`
- Activated by setting `enable_home_control = true` (default)

## Acceptance Criteria

- [ ] New repo `mchacher/sowel-plugin-legrand-control`
- [ ] Discovers Home+Control modules (lights, shutters, plugs, meters)
- [ ] Polls homesdata + homestatus APIs
- [ ] Executes orders via setstate API (on/off, brightness, target_position)
- [ ] Rapid polling after order for quick state feedback
- [ ] OAuth authentication with token rotation
- [ ] Integration ID: `legrand_control`
- [ ] Settings prefix: `integration.legrand_control.*`
- [ ] Token file: `data/legrand-control-tokens.json`
- [ ] Pre-built tarball release via GitHub Actions
- [ ] Added to `plugins/registry.json`

## Scope

### In Scope

- Module discovery (NLP, NLF, NLT, NLL, NLPC, etc.)
- Status polling (on/off, brightness, position, power)
- Order dispatch (setstate)
- Rapid poll on order for quick feedback
- Stale device cleanup

### Out of Scope

- Weather station (048a)
- Energy monitoring/backfill (048c)
- Migration of existing devices from `netatmo_hc` to `legrand_control` (manual re-binding)
