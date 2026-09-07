# Implementation Plan — Spec 177

Branch: `feat/issue-921-thermostat-contract`. Closes #921.

## Slices

### Slice A — Declaration (shared)

- A.1 — `src/shared/thermostat-contract.ts`: the core table, derived sets, identity, extras split;
  `THERMOSTAT_STATE_ALIAS` moves here.
- A.2 — `src/shared/binding-candidates.ts`: re-export the alias; gate the thermostat candidate on
  the identity; split it from `heater`.
- A.3 — `ui/src/lib/thermostat-contract.ts`: UI re-export.
- A.4 — Tests: `src/shared/thermostat-contract.test.ts`.

### Slice B — Binding derives from the contract (UI)

- B.1 — `bindingUtils.ts`: drop `RELEVANT_ORDERS.thermostat`, add `BIND_ALL_ORDER_TYPES`, add the
  per-type `temperature` category rule, comment `STANDARD_ALIASES.thermostat` as the #922 layer.
- B.2 — `DeviceSelector.tsx`: drop `EQUIPMENT_TYPE_DATA_KEYS.thermostat`, branch on
  `isThermostatDevice`.
- B.3 — Tests in `bindingUtils.test.ts`: unknown-vendor thermostat plan (fails before B.1).

### Slice C — The card

- C.1 — `ThermostatExtras.tsx`: generic renderer.
- C.2 — `ThermostatCard.tsx`: strip the vendor branches, mount the extras.
- C.3 — i18n: move value labels under `thermostat.values.*`, add `thermostat.extras.*`, EN + FR.
- C.4 — Tests in `ThermostatCard.test.tsx`.

### Slice D — Docs

- D.1 — `docs/user/equipments.md` + `.fr.md`.
- D.2 — `docs/technical/data-model/equipments.md`.
- D.3 — `docs/specs-index.md` + `.fr.md`, row 177; forward pointer in spec 176.

## Test Plan

### Modules to test

- `src/shared/thermostat-contract.ts` (new logic)
- `ui/src/components/equipments/bindingUtils.ts` (plan for a thermostat)
- `ui/src/components/equipments/ThermostatCard.tsx` + `ThermostatExtras.tsx` (rendering + orders)

### Scenarios

| Module              | Scenario                                                            | Expected                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| thermostat-contract | Core sets                                                           | data = temperature/setpoint/state/power/operationMode/outsideTemperature; order = power/setpoint/operationMode                              |
| thermostat-contract | Identity: Panasonic-like (setpoint data + set_setpoint order)       | true                                                                                                                                        |
| thermostat-contract | Identity: MCZ-like                                                  | true                                                                                                                                        |
| thermostat-contract | Identity: order-only device (set_setpoint, no data yet)             | true                                                                                                                                        |
| thermostat-contract | Identity: temperature sensor, clamp                                 | false                                                                                                                                       |
| thermostat-contract | Extras split on the full MCZ surface                                | core excluded, extras sorted by alias, `state`/`power` never extras                                                                         |
| binding-candidates  | thermostat candidate on a sensor                                    | `[]`; on a Panasonic-like, one "all" candidate                                                                                              |
| bindingUtils        | Unknown-vendor thermostat: `room_temp`/`target`/`on`/`mode`/`swing` | temperature, setpoint, power (core) + mode, swing bound under their keys (extras)                                                           |
| bindingUtils        | Panasonic-like plan (existing test)                                 | unchanged aliases; `fanSpeed`, `nanoe` orders now in the plan                                                                               |
| bindingUtils        | Submetered PAC missing-bindings (existing test)                     | unchanged                                                                                                                                   |
| ThermostatCard      | MCZ-like full surface                                               | profile buttons send `profile`; eco toggle sends `ecoMode`; reset sends `resetAlarm: true`; stove state, pellet, ignition count chips shown |
| ThermostatCard      | Panasonic-like full surface                                         | mode selector from `operationMode` sends `operationMode`; fan speed sends `fanSpeed`; nanoe/air swing controls present                      |
| ThermostatCard      | `resetAlarm` bound, no `stoveState`                                 | button present and enabled (fails before: gated on the stove state)                                                                         |
| ThermostatCard      | Unknown extra `swing` enum                                          | rendered with raw labels, sends `swing`                                                                                                     |
| ThermostatCard      | Core only                                                           | no extras section                                                                                                                           |
| ThermostatCard      | Spec 176 power-state suite                                          | unchanged                                                                                                                                   |

### Retro-compat

- Every existing thermostat keeps its bindings; nothing writes to the database.
- `useEquipmentState`, `EquipmentWidget`, `WidgetDetailSheet`, `ZoneWidget`, `CompactThermostat`
  read core aliases only and are untouched.

## Validation Plan

- `npx tsc --noEmit`, `npm run typecheck:tests`, `npx eslint src/ --ext .ts`, `npx vitest run`
- `cd ui && npx tsc -b --noEmit && npx eslint . && npx vitest run`
- `bash scripts/check-docs-parity.sh`, `bash scripts/check-docs-impact.sh`,
  `bash scripts/check-specs-index.sh folders`
- Manual: a Panasonic-shaped and an MCZ-shaped thermostat in the card, extras visible and driving
  orders; the device selector offers a setpoint-carrying device and not a sensor.
