# Spec 193 — Plan

## Tasks

- [x] Contract constants and `isMeteredChargerDevice`; migration 040; types
- [x] `attribute()` usual-vehicle tie-break
- [x] Tracker: metered open / close / restore, `resolve()` with FR4, `listOverlapping`
- [x] `usualVehicleId` in the equipment manager and route; cleared on vehicle removal
- [x] UI: metered devices in the device selector, usual-vehicle select, reason label, live state without vehicle state
- [x] Docs EN/FR, data model, specs index

## Test Plan

| Module                        | Scenario                                                                                               | Expected                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| attribution                   | several matches, usual among them                                                                      | vehicle = usual, reason `usual-vehicle`                            |
| attribution                   | several matches, usual not among them / none                                                           | `several-matches`                                                  |
| attribution                   | no match, usual set                                                                                    | `no-match` (no fallback)                                           |
| ev-charger-contract           | energy meter device (power, energy)                                                                    | metered; a real charger is not metered                             |
| ev-session-tracker            | metered: 3 kW for 60 min, then 0 W                                                                     | one session, closed 30 min later, `endedAt` = last ≥ 500 W reading |
| ev-session-tracker            | metered: 20 min pause inside                                                                           | one session                                                        |
| ev-session-tracker            | metered: 45 min pause                                                                                  | two sessions                                                       |
| ev-session-tracker            | metered: 600 W spike for 1 min                                                                         | session dropped (< 100 Wh)                                         |
| ev-session-tracker            | metered: restart with an open session, power 0 since 40 min                                            | closed at the binding's last change                                |
| ev-session-tracker            | metered: restart, power ≥ 500 W, no session                                                            | opened                                                             |
| ev-session-tracker            | charger with a vehicle state, power ≥ 500 W before `vehicle`                                           | no session from the power                                          |
| ev-session-tracker            | both cars charge, charger usual = B                                                                    | decided B, `usual-vehicle`                                         |
| ev-session-tracker            | car A on charger 1 (no usual), car B on metered charger 2 (usual B), overlapping, both report charging | charger 2 → B, charger 1 → A                                       |
| ev-session-tracker            | the same, charger 1 decided before charger 2 closes                                                    | charger 1 → A (charger 2's provisional result counts)              |
| ev-session-tracker            | `currentForVehicle` with FR4                                                                           | car B sees the charger 2 session only                              |
| ev-session-tracker            | vehicle removed                                                                                        | chargers naming it lose it                                         |
| equipments route              | `usualVehicleId` on a charger / on a light / to a non-vehicle / null                                   | 200 / 400 / 400 / cleared                                          |
| evSessionsDisplay `liveState` | no vehicle state, 1300 W / 0 W                                                                         | charging 1300 / paused, reason null                                |
