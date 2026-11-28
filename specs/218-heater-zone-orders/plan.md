# Implementation Plan — Spec 218

## Tasks

- [x] Shared: `heaterModeOrder`, `zoneHeaterModes` + tests
- [x] Backend: `allHeatersMode` in `ZONE_ORDERS`, value check, dispatch + tests
- [x] UI: `HeaterModeMenu`
- [x] UI: Maison command bar (heaters group, subtree modes)
- [x] UI: zone Heating widget (menu, common mode, on/off for thermostats only)
- [x] UI: button action option with mode select
- [x] i18n FR/EN
- [x] Docs delta EN/FR

## Test Plan

### Modules to test

- `src/shared/heater-contract.ts` (`heaterModeOrder`, `zoneHeaterModes`)
- `src/equipments/equipment-manager.ts` (`executeZoneOrder` with `allHeatersMode`)

### Scenarios

| Module            | Scenario                                         | Expected                                  |
| ----------------- | ------------------------------------------------ | ----------------------------------------- |
| heater-contract   | Pilot heater, accepted mode                      | `{ alias: pilot_wire_mode, value: mode }` |
| heater-contract   | Pilot heater, mode not in its `enumValues`       | null                                      |
| heater-contract   | Relay, comfort / eco                             | toggle alias, `OFF` / `ON`                |
| heater-contract   | Relay with enum `on`/`off` values                | the declared casing                       |
| heater-contract   | Relay, frost_protection / comfort_minus_1        | null                                      |
| heater-contract   | Relay without toggle order                       | null                                      |
| heater-contract   | zoneHeaterModes, relays only                     | `[comfort, eco]`                          |
| heater-contract   | zoneHeaterModes, relay + pilot with subset       | union in contract order                   |
| heater-contract   | zoneHeaterModes, same mode / different / unknown | common mode / null / null                 |
| heater-contract   | zoneHeaterModes, no commandable heater           | `modes: []`                               |
| equipment-manager | `allHeatersMode` eco, one relay + one pilot      | relay `ON`, pilot `eco`, executed 2       |
| equipment-manager | `allHeatersMode` frost_protection, relay + pilot | pilot only, executed 1, relay untouched   |
| equipment-manager | Unknown value                                    | 400 error, nothing executed               |
| equipment-manager | Disabled heater                                  | skipped                                   |
| equipment-manager | Existing zone orders                             | unchanged (existing tests stay green)     |
