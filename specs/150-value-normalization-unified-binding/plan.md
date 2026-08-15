# Spec 150 — Implementation Plan

Branch: `feat/150-value-normalization-unified-binding`

## Recorded decisions (implementation)

- **UI import strategy**: relative re-export (`ui/src/lib/binding-candidates.ts`
  re-exports `../../../src/shared/binding-candidates`) instead of a path alias —
  zero import-site churn, verified against `tsc -b`, `vite build` and the dev
  server. `ui/vite.config.ts` gains `server.fs.allow: [".", "../src/shared"]`
  (scoped — never the repo root).
- **Gate candidates bind no relay-state data** (virtual-state alias collision +
  zone lights-on pollution); feedback rows (RS\*/contact) attach to every trigger
  candidate; no blanket "all data" fallback.
- **`TYPE_CATEGORY_ALIASES`** (renamed from `TYPE_DATA_CATEGORY_ALIASES`) gains
  `gate: { light_toggle: "command", toggle_power: "command" }`.
- **`executeOrder` boolean-empty resolution** (review finding B1): null/empty on a
  boolean binding → `true`, then #360 wire mapping. Non-empty values pass through
  untouched — coercing "ON" strings to booleans here would break pre-2.3.0 z2m
  plugins that rely on the raw string reaching the wire.
- **`normalizeValue` unknown-type default** (review finding M1): tolerant
  pass-through for community plugins declaring types outside the union.
- **ON/OFF enum tolerated** for boolean-expected categories in the F4 discovery
  check (Tasmota pattern, no false warns).

## Tasks

### Step 1 — Shared normalization authority

- [x] Create `src/shared/value-normalization.ts` (`normalizeValue`, pure, F1 table + `isCategoryTypeMismatch` + unknown-type default).
- [x] Create `src/shared/value-normalization.test.ts`.

### Step 2 — Constants

- [x] Add `CATEGORY_EXPECTED_TYPE` to `src/shared/constants.ts` (boolean + number
      semantic categories; `generic`, `action`, text-ish categories left out).
      `METERING_CATEGORIES` moved here from `equipments/metering.ts` (re-exported).

### Step 3 — Ingestion wiring (device-manager)

- [x] `updateDeviceData`: normalize per declared row before persist + emission;
      warn-once dedupe per (deviceId, key).
- [x] `upsertFromDiscovery`: warn on `CATEGORY_EXPECTED_TYPE` contradiction,
      warn-once dedupe.
- [x] Extend `src/devices/device-manager.test.ts` (extended, not overwritten).

### Step 4 — Shared binding candidates

- [x] Move `src/equipments/binding-candidates.ts` → `src/shared/binding-candidates.ts`;
      self-contained structural input types; export `CANDIDATE_BASED_TYPES` (incl.
      `gate`).
- [x] Implement F7 gate case (trigger-like filter + feedback attach + contact
      candidate, no blanket fallback).
- [x] `light_dimmable`/`light_color` widened `isOnOffEnum` → `isOnOffOrder`.
- [x] Move + extend tests → `src/shared/binding-candidates.test.ts`.
- [x] `executeOrder` boolean-empty resolution + tests (review B1).

### Step 5 — UI swap

- [x] `ui/src/lib/binding-candidates.ts` → thin re-export (test file kept, now
      exercising the shared module through the re-export).
- [x] Replace imports in `bindingUtils.ts` + `DeviceSelector.tsx`; delete both local
      `CANDIDATE_BASED_TYPES` copies, the gate special-case filter and the dead
      `EQUIPMENT_TYPE_CATEGORIES.gate` entry.
- [x] `TYPE_CATEGORY_ALIASES` gate override; `vite.config.ts` `server.fs.allow`.

### Step 6 — Validation

- [x] `npx tsc --noEmit`, `cd ui && npx tsc -b --noEmit`
- [x] `npx vitest run` (all green)
- [x] `npx eslint src/` and `cd ui && npx eslint .`
- [x] `npm run validate`
- [x] `vite build` + dev-server smoke test of the cross-root import
- [x] Phase 5 adversarial review (findings B1/M1/M3/m3/m4/m6 fixed; M2 = these doc
      updates; m1/m2 accepted as documented limitations; m5 deferred)

## Test Plan

### Modules to test

- `src/shared/value-normalization.ts` (new)
- `src/devices/device-manager.ts` (ingestion behavior)
- `src/shared/binding-candidates.ts` (moved + gate case)

### Scenarios

| Module              | Scenario                                                            | Expected                                                           |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| value-normalization | boolean: `"ON"`, `"on "`, `"true"`, `"1"`, `1`                      | `true`, not flagged                                                |
| value-normalization | boolean: `"OFF"`, `"false"`, `"0"`, `0`, `false`                    | `false`, not flagged                                               |
| value-normalization | boolean: `"OPEN"`, `"CLOSED"`, `"DETECTED"`, `2`, `{}`              | raw, flagged                                                       |
| value-normalization | number: `42.5`, `"42.5"`, `" 7 "`                                   | number, not flagged                                                |
| value-normalization | number: `"abc"`, `NaN`, `true`                                      | raw, flagged                                                       |
| value-normalization | enum: `"on"` with `["ON","OFF"]`                                    | `"ON"` (canonical casing)                                          |
| value-normalization | enum: `"HEAT"` with `["ON","OFF"]`                                  | raw, flagged                                                       |
| value-normalization | enum: string, no enumValues                                         | unchanged, not flagged                                             |
| value-normalization | text: `42` / `true`                                                 | `"42"` / `"true"`                                                  |
| value-normalization | json: object                                                        | unchanged                                                          |
| value-normalization | any type: `null` / `undefined`                                      | unchanged, not flagged                                             |
| device-manager      | `{"state":"ON"}` on boolean-declared key                            | stores/emits `true`                                                |
| device-manager      | `{"power":"42.5"}` on number-declared key                           | stores/emits `42.5`                                                |
| device-manager      | un-coercible value twice on same key                                | raw stored, exactly one warn                                       |
| device-manager      | key with no declared row                                            | today's behavior (typeof-inferred), no warn                        |
| device-manager      | discovery: `contact_door` declared as `text`                        | one warn, row created                                              |
| device-manager      | discovery: coherent types                                           | no warn                                                            |
| binding-candidates  | dimmable light (`state`+`brightness`, boolean) for `light_dimmable` | 1 candidate with both keys                                         |
| binding-candidates  | color light for `light_color`                                       | 1 candidate                                                        |
| binding-candidates  | boolean relay (`state`, `light_toggle`) for `gate`                  | 1 `command`-able candidate, dataKeys `[]` (no relay-state binding) |
| binding-candidates  | relay config exposes (`power_on_behavior`…) for `gate`              | not candidates                                                     |
| binding-candidates  | contact-only sensor (SNZB-04P shape) for `gate`                     | 1 contact candidate, no orderKeys, contact key only                |
| binding-candidates  | Somfy RTS (`gate_trigger` order) for `gate`                         | unchanged: 1 candidate                                             |
| binding-candidates  | LoRa R1 relay + RS reed on one device for `gate`                    | 1 candidate, orderKeys `["R1"]`, dataKeys `["RS1"]`                |
| binding-candidates  | LoRa reed (`RS` data only) for `gate`                               | 1 contact candidate carrying the RS keys                           |
| binding-candidates  | plain sensor (no trigger, no feedback) for `gate`                   | zero candidates                                                    |
| binding-candidates  | every `CANDIDATE_BASED_TYPES` entry                                 | has a dedicated case (never the default fallback)                  |
| binding-candidates  | regression: full existing test suite                                | passes against shared module                                       |
| equipment-manager   | `executeOrder(null)` on boolean `command` binding with wire values  | dispatches `{state:"ON"}` (spec 150 / review B1)                   |
| equipment-manager   | `executeOrder("ON")` on boolean binding without wire values         | raw `"ON"` passes through (pre-2.3.0 z2m compat)                   |

### Retro-compat checks

| Area                | Check                                                     |
| ------------------- | --------------------------------------------------------- |
| Tasmota enum orders | `power1` enum path untouched (dispatch tests still green) |
| History writer      | boolean/number field emission unchanged (existing tests)  |
| Existing bindings   | no migration; lazy normalization on next update           |
| UI stores/tests     | root vitest run includes `ui/src` tests — all green       |
