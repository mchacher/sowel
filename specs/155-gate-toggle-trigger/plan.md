# Implementation Plan — Spec 155 (Toggle-Based Gate Trigger Resolution)

## Steps

1. Types — `Equipment.gateTriggerMode` (backend `shared/types.ts`, UI `types.ts`).
2. Migration `025_equipment_gate_trigger_mode.sql`.
3. `DeviceManager.getDeviceDataValueById(deviceId, key)` — deviceId-keyed variant of `getDeviceDataValue`, decode logic extracted and shared.
4. `EquipmentManager`: row type, `rowToEquipment`, `UpdateEquipmentInput`, `updateEquipment` SQL/params, `resolveOrderValue` toggle branch, `executeOrder` call site passing `equipment.gateTriggerMode`.
5. Tests (backend): `equipment-manager.test.ts` (toggle: no prior value, prior true, prior false, fixed-default regression guard, round-trip through update), `device-manager.test.ts` (`getDeviceDataValueById`: unknown device, unwritten key, parity with `getDeviceDataValue`).
6. API route: schema + body type + pass-through in `PUT /equipments/:id`; test in `equipments.test.ts` (accepts `fixed`/`toggle`, rejects invalid enum value).
7. UI: `GateTriggerModePanel.tsx` (mirrors `InvertDirectionPanel`), mounted in `EquipmentDetailPage.tsx` for `isGate && isAdmin`, i18n strings (en/fr), component test.
8. Validation: `tsc`/`eslint`/`vitest` both sides.
9. Deploy to dev VM, set `gateTriggerMode: "toggle"` on the real `PorteGarageGauche` equipment, trigger repeatedly via the Sowel API/UI (not just Z2M directly) and confirm the physical door moves on every press.

## Test Plan

### Modules to test

- `equipment-manager.ts` — `resolveOrderValue` toggle branch, `update()` round-trip
- `device-manager.ts` — `getDeviceDataValueById`
- `api/routes/equipments.ts` — schema validation for the new field

### Scenarios per module

| Module            | Scenario                                           | Expected                                                                                         |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| equipment-manager | toggle mode, no prior device data                  | resolves to `true` (same as fixed default)                                                       |
| equipment-manager | toggle mode, prior value `true`                    | resolves to `false`                                                                              |
| equipment-manager | toggle mode, prior value `false`                   | resolves to `true`                                                                               |
| equipment-manager | fixed mode (default), prior value `true`           | still resolves to `true` (regression guard — no accidental toggling for non-opted-in equipments) |
| equipment-manager | `update()` sets/clears `gateTriggerMode`           | round-trips through `getById`                                                                    |
| device-manager    | `getDeviceDataValueById` unknown deviceId          | `null`                                                                                           |
| device-manager    | `getDeviceDataValueById` key never written         | `null`                                                                                           |
| device-manager    | `getDeviceDataValueById` vs `getDeviceDataValue`   | same decoded value for the same underlying row                                                   |
| equipments API    | `PUT` with `gateTriggerMode: "toggle"` / `"fixed"` | 200                                                                                              |
| equipments API    | `PUT` with an invalid enum value                   | 400                                                                                              |

## Test Results

Automated: `npx vitest run` — 97/97 backend test files (1583 tests) and 56/56 UI test files (520 tests) green, `tsc --noEmit` and `eslint` clean on both sides (backend and UI).

Real-hardware validation on the dev VM (2026-08-19): backup taken, deployed via `git archive` + `docker build` + hot-patch (no new npm dependency, `dist`/`ui-dist`/`migrations` only), migration `025_equipment_gate_trigger_mode.sql` applied cleanly. `gateTriggerMode` set to `"toggle"` on the real `PorteGarageGauche` equipment via `PUT /equipments/:id`. 3 consecutive `POST /equipments/:id/orders/command` calls, physical door observed each time: all 3 moved the door (previously only the very first press worked; every subsequent press silently failed). Zero regression on the rest of the instance. See `CONTEXT_ROMAIN.md` (not part of this repo) for the full narrative.
