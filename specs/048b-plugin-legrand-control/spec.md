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

- [x] New repo `mchacher/sowel-plugin-legrand-control`
- [x] Discovers Home+Control modules (lights, shutters, plugs, gateway — all models EXCEPT NLPC)
- [x] Polls homesdata + homestatus APIs
- [x] Executes orders via setstate API (on/off, brightness, target_position)
- [x] Rapid polling after order for quick state feedback
- [x] OAuth authentication with token rotation
- [x] Integration ID: `legrand_control`
- [x] Settings prefix: `integration.legrand_control.*`
- [x] Token file: `data/legrand-control-tokens.json`
- [x] Pre-built tarball release via GitHub Actions
- [x] Added to `plugins/registry.json`
- [x] Device migration: 6 non-NLPC devices migrated from netatmo_hc to legrand_control
- [x] Control code removed from built-in netatmo-hc (only energy/NLPC code remains)
- [x] No user-facing regression: energy bindings intact (Total, Solaire), control devices had no equipment bindings

## Module Models

| Category      | Models                                      | Plugin                       |
| ------------- | ------------------------------------------- | ---------------------------- |
| Switches      | NLPT, NLPO, NLL, NLIS, NLP, NLPM, NLPD, NLC | legrand_control              |
| Dimmers       | NLF, NLFE, NLFN                             | legrand_control              |
| Shutters      | NLV, NLLV, NLIV                             | legrand_control              |
| Gateway       | NLG, NLGS                                   | legrand_control              |
| Energy meters | NLPC                                        | stays in netatmo_hc (→ 048c) |

## Scope

### In Scope

- Module discovery (all models except NLPC)
- Status polling (on/off, brightness, position, wifi_strength)
- Order dispatch (setstate)
- Rapid poll on order for quick feedback
- Stale device cleanup
- Device migration from netatmo_hc by model

### Out of Scope

- Weather station (done in 048a)
- Energy meters NLPC (048c)
- Energy monitoring / getmeasure / backfill (048c)
