# Spec 081 — Implementation Plan

## Task Breakdown

### Phase 1 — Types + Migration

- [x] 1.1 Add `pool_pump` + `pool_cover` to `EquipmentType` (src/shared/types.ts)
- [x] 1.2 Add `pool` to `WidgetFamily` (src/shared/types.ts)
- [x] 1.3 Add 3 new `OrderCategory` values: `pool_pump_toggle`, `pool_cover_move`, `pool_cover_position`
- [x] 1.4 Add `pool` entry to `WIDGET_FAMILY_TYPES` (src/shared/constants.ts)
- [x] 1.5 Add new equipment types to `VALID_EQUIPMENT_TYPES` (equipment-manager.ts)
- [x] 1.6 Mirror all in `ui/src/types.ts`
- [x] 1.7 Create migration `006_pool_runtime_and_category_override.sql`:
  - `CREATE TABLE pool_runtime_state`
  - `ALTER TABLE order_bindings ADD COLUMN category_override TEXT`

### Phase 2 — Binding Candidates + Override

- [x] 2.1 Implement `computeBindingCandidates(equipmentType, deviceData, deviceOrders)` in `src/equipments/binding-candidates.ts`
- [x] 2.2 Implement `hasFreeCandidates(equipmentType, deviceData, deviceOrders, boundOrderKeys)` helper
- [x] 2.3 Implement `inferBindingCategory(equipmentType, order)` helper
- [x] 2.4 Update `equipment-manager.addOrderBinding()` to compute + persist override
- [x] 2.5 Update `equipment-manager.update()` when `type` changes → retag all existing bindings' overrides
- [x] 2.6 Update `getOrderBindingsWithDetails` SQL to `COALESCE(ob.category_override, do2.category)`
- [x] 2.7 Update `OrderBindingJoinRow` mapper

### Phase 3 — Pool Runtime Tracker

- [x] 3.1 Implement `src/equipments/pool-runtime-tracker.ts` (load/persist, midnight reset, event subscription, virtual runtime_daily emission)
- [x] 3.2 Wire PoolRuntimeTracker in `src/index.ts` (after equipment-manager, event-bus)
- [x] 3.3 Surface `runtime_daily` to the UI as a `ComputedDataEntry` (cleaner than the virtual binding originally planned — no schema changes)

### Phase 4 — Cover State Deriver

- [x] 4.1 Implement `deriveCoverState(positionBinding)` in equipment-manager.ts
- [x] 4.2 Append virtual `cover_state` entry in `getDataBindingsWithValues` for pool_cover

### Phase 5 — Backend Tests

- [x] 5.1 Tests for `computeBindingCandidates` (4 scenarios)
- [x] 5.2 Tests for `hasFreeCandidates` (3 scenarios)
- [x] 5.3 Tests for `inferBindingCategory` (4 scenarios)
- [x] 5.4 Tests for `equipment-manager.addOrderBinding` with override (2 scenarios)
- [x] 5.5 Tests for `equipment-manager.update({type})` re-tagging (2 scenarios)
- [x] 5.6 Tests for `deriveCoverState` (6 scenarios)
- [x] 5.7 Tests for `PoolRuntimeTracker` (6 scenarios — including non-pool ignored, equipment.removed cleanup)

### Phase 6 — Frontend Icons + Registry

- [x] 6.1 Implement `PoolPumpIcon({ on })` in `WidgetIcons.tsx` (Design F, validated)
- [x] 6.2 Implement `PoolCoverIcon({ position })` in `WidgetIcons.tsx` (Design G, validated)
- [x] 6.3 Add `WaterValveWidgetIcon({ open })` in `WidgetIcons.tsx` (replaces previous static icon)
- [x] 6.4 Update `CUSTOM_ICON_REGISTRY` entries (pool_pump, pool_cover, water_valve fix)
- [x] 6.5 Update `EQUIPMENT_DEFAULT_ICONS` + `FAMILY_DEFAULT_ICONS`

### Phase 7 — Frontend UX (Binding)

- [x] 7.1 Add `pool_pump` + `pool_cover` to `EquipmentForm.tsx` type list and `DeviceSelector.tsx` category map.
- [ ] 7.2 (Follow-up) `DeviceSelector` filtering via `hasFreeCandidates(type, device)` — backend helper + tests are in place; UI wiring deferred to a separate spec to keep this PR focused.
- [ ] 7.3 (Follow-up) Picker UX in `EquipmentForm` / `AddBindingModal` for N-candidate devices.

### Phase 8 — Frontend Widgets

- [x] 8.1 Add `WaterValveEquipmentWidget`, `PoolPumpEquipmentWidget`, `PoolCoverEquipmentWidget` to `EquipmentWidget.tsx`
- [x] 8.2 Implement Open/Stop/Close actions for pool_cover
- [x] 8.3 Implement ON/OFF toggle for water_valve (fix)
- [x] 8.4 `formatRuntime(seconds)` helper for runtime_daily display (`"3h 45m"`)

### Phase 9 — Validate

- [x] 9.1 `npx tsc --noEmit` zero errors (backend)
- [x] 9.2 `cd ui && npx tsc -b --noEmit` zero errors (frontend)
- [x] 9.3 `npx vitest run` all pass (365 tests)
- [x] 9.4 `npx eslint src/ --ext .ts` zero errors

### Phase 10 — Manual Verification

- [ ] 10.1 Create 3 equipments from 1 Tasmota 4CH Pro:
  - POMPE as pool_pump bound to POWER1
  - SPOT as light_onoff bound to POWER2
  - VOLET as pool_cover bound to shutter group
- [ ] 10.2 Verify DeviceSelector shows the Tasmota only if free candidates exist for the type
- [ ] 10.3 Verify Picker UI appears when multiple candidates
- [ ] 10.4 Verify widget renders correctly on dashboard for all 3 + runtime_daily accumulates
- [ ] 10.5 Verify water_valve icon + toggle fix

## Test Plan

### Modules to test

| Module                              | Scenarios                                                                            | Count |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ----- |
| `computeBindingCandidates`          | pool_pump multi-relay, pool_cover with shutter, switch single-relay, sensor all-data | 4     |
| `hasFreeCandidates`                 | 0 bindings / partial / full                                                          | 3     |
| `inferBindingCategory`              | pool_pump toggle, pool_cover move, pool_cover position, non-pool returns null        | 4     |
| `equipment-manager.addOrderBinding` | override set / not set                                                               | 2     |
| `equipment-manager.update({type})`  | override retagged on switch→pool_pump, override cleared on pool_pump→switch          | 2     |
| `deriveCoverState`                  | OPEN, CLOSED, PARTIAL, null, tolerance 0-5, tolerance 95-100                         | 6     |
| `PoolRuntimeTracker`                | transitions, cycles, midnight reset, startup recovery, non-pool ignored              | 6     |

### Scenarios table (highlights)

| Module                      | Scenario                                                  | Expected                                                             |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| computeBindingCandidates    | pool_pump on Tasmota 4CH (power1..4 enum)                 | 4 candidates, one per power                                          |
| computeBindingCandidates    | pool_cover on Tasmota with shutter_state+shutter_position | 1 candidate grouping both                                            |
| computeBindingCandidates    | switch on Sonoff Mini                                     | 1 candidate (power1)                                                 |
| computeBindingCandidates    | sensor on weather station                                 | 1 candidate including all data                                       |
| hasFreeCandidates           | device with 4 candidates, 2 bound elsewhere               | true (2 free)                                                        |
| hasFreeCandidates           | device with 4 candidates, all 4 bound                     | false                                                                |
| inferBindingCategory        | pool_pump + enum ["ON","OFF"]                             | "pool_pump_toggle"                                                   |
| inferBindingCategory        | pool_cover + enum ["OPEN","CLOSE","STOP"]                 | "pool_cover_move"                                                    |
| inferBindingCategory        | pool_cover + number type, min=0 max=100                   | "pool_cover_position"                                                |
| inferBindingCategory        | switch + enum ["ON","OFF"]                                | null                                                                 |
| equipment-manager.update    | type switch → pool_pump                                   | all order_bindings' category_override recomputed to pool_pump_toggle |
| equipment-manager.update    | type pool_pump → switch                                   | all order_bindings' category_override set to null                    |
| getOrderBindingsWithDetails | binding with override                                     | returns override as category                                         |
| getOrderBindingsWithDetails | binding without override                                  | returns device_order.category                                        |
| deriveCoverState            | position=50, direction=null                               | "PARTIAL"                                                            |
| deriveCoverState            | position=2 (tolerance)                                    | "CLOSED"                                                             |
| PoolRuntimeTracker          | ON at T0, OFF at T0+60s                                   | cumulative = 60                                                      |
| PoolRuntimeTracker          | startup with last_reset_date=yesterday                    | cumulative reset to 0                                                |

### Not tested

- React components (icons, forms) — visual only
- Simple CRUD
- Existing behavior for untouched types (covered by regression)
