# Implementation Plan — Spec 217

## Slices

### Slice A — Contract (Sowel)

- [x] A.1 — Categories and `heater-contract.ts` with its tests
- [x] A.2 — Binding selection in candidates, UI plan and API path

### Slice B — Surfaces (Sowel)

- [x] B.1 — Resolver in running state, widgets and zone widget
- [x] B.2 — Mode selector and badge, i18n, tap opens the sheet
- [x] B.3 — Docs EN/FR

### Slice C — Plugin (own repository and PR)

- [x] C.1 — `pilot-wire.ts`, parser, orders, tests
- [x] C.2 — Plugin 2.10.0 released and registry bumped, ahead of the core release
- [ ] C.3 — Core release notes naming the missing-bindings panel; hardware check

## Test Plan

| Module                                             | Scenario                                              | Expected                                      |
| -------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| heater-contract                                    | Relay ON / OFF / no state                             | eco / comfort / comfort (unknown since #1331) |
| heater-contract                                    | Pilot mode plus contradictory `state`                 | Pilot mode wins                               |
| heater-contract                                    | Pilot value null or unknown                           | Mode null, wiring pilot                       |
| heater-contract                                    | Order with a subset, a foreign value, or no enum      | Subset, filtered, all six                     |
| heater-contract                                    | Data only / order only                                | No modes offered / mode null, modes given     |
| binding-candidates                                 | Pilot device with state, metering, probes             | Mode and metering only                        |
| binding-candidates                                 | Relay device                                          | Unchanged                                     |
| bindingUtils                                       | Plan and missing bindings for a pilot device          | Alias `pilot_wire_mode`, no `state`           |
| bindingUtils                                       | Plan for a relay device                               | Unchanged                                     |
| equipment-manager                                  | API creation, pilot device / relay device             | No `state` / unchanged                        |
| equipment-running                                  | Each pilot mode, unknown, relay                       | Only comforts run                             |
| HeaterControl                                      | Pilot: buttons, click, disabled; relay: toggle        | Right order alias and value                   |
| ZoneWidget                                         | Relay in eco / comfort, pilot eco / comfort           | Cold / warm, cold / warm                      |
| mobile-click-action                                | Tap on a pilot heater                                 | Opens the sheet                               |
| EquipmentWidget                                    | Tap on a pilot tile / relay tile                      | Sheet / toggle                                |
| HeaterDetailSheet                                  | Pilot with `state` bound / relay both ways            | Mode buttons only / right value               |
| WidgetGrid, MobileWidgetCard, CompactEquipmentCard | Pilot heater                                          | Warm state, mode, selector                    |
| ZoneWidget                                         | On/off button beside a warm or eco heater             | Commands the thermostats on                   |
| plugin pilot-wire                                  | Six values both ways, unknown value                   | Translated, passed through                    |
| plugin parser                                      | Discovery and payload of a SIN-4-FP-21; other devices | Categories, values; unchanged                 |
| plugin executeOrder                                | `pilot_wire_mode` order; same string on another key   | Z2M value sent; untouched                     |

## Validation Plan

- `npm run validate`, docs and spec checks, `docker build --target ui-build`
- Plugin tests in its repository
- Real module: each mode, `state`, power cut, metering
