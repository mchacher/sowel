# Plan — Spec 135 Water heater

Branch `feat/water-heater-equipment`.

## Implementation order

1. **Types**: `EquipmentType` union (`src/shared/types.ts` + `ui/src/types.ts`),
   `VALID_EQUIPMENT_TYPES` (equipment-manager).
2. **Binding candidates**: `water_heater` case in
   `src/equipments/binding-candidates.ts` and its UI mirror
   `ui/src/lib/binding-candidates.ts` (isOnOffOrder + metering attach).
3. **Binding config**: `DeviceSelector` (categories + candidate-based),
   `bindingUtils` (RELEVANT_DATA/ORDERS + `water_temperature` alias rule).
4. **Tests** (see Test Plan) — backend + UI candidate tests + alias rule.
5. **Icon**: `WaterHeaterIcon` in `WidgetIcons.tsx` + registry entry.
6. **Dashboard**: desktop `WaterHeaterEquipmentWidget`, mobile branch,
   zone card, detail control, widget routing (widget-utils / grid / detail
   sheet / zone widget).
7. **Form + i18n**: EquipmentForm option, FR/EN labels.
8. **Docs**: equipments.{md,fr.md}, data-model.md.
9. Validate: backend tsc/eslint/vitest, UI tsc -b/eslint.
10. Manual verification against the friend's real WHD02 water heaters
    (shadow or live): create, auto-bind on/off, add temp, control, dashboard.

## Test Plan

### Modules to test

- `binding-candidates.ts` (backend) + `ui/src/lib/binding-candidates.ts`
  — the `water_heater` candidate case.
- `bindingUtils.ts` — the `water_temperature` alias rule + RELEVANT filters
  (via `autoCreateBindings`/`resolveAlias` if unit-testable; else covered
  by the candidate tests + manual).

### Scenarios

| Module        | Scenario                                                  | Expected                                                                 |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| binding-cands | water_heater + boolean light_toggle `state`               | one on/off candidate                                                     |
| binding-cands | water_heater + ON/OFF enum `state` (Tasmota)              | one on/off candidate                                                     |
| binding-cands | water_heater single relay + power/energy/voltage/current  | metering attached to the single candidate                                |
| binding-cands | water_heater + non-power boolean toggle only (child_lock) | zero candidates                                                          |
| binding-cands | water_heater multi-gang (state_l1/state_l2)               | two candidates, no metering auto-attach                                  |
| alias rule    | temperature-category data on a water_heater               | alias resolved to `water_temperature`                                    |
| alias rule    | temperature aliased `water_temperature`                   | zone aggregator excludes it from room avg (existing guard, assert alias) |
| retro-compat  | heater / switch candidates                                | unchanged                                                                |

### Retro-compat

- `heater` and `switch` cases untouched; existing candidate tests keep
  passing.
- Zone temperature aggregation unchanged (only alias `temperature` folds
  in) — the alias rule keeps water heaters out by construction.

## Tasks

- [x] P1 Types + VALID_EQUIPMENT_TYPES
- [x] P2 Binding candidates (backend + UI mirror) + tests
- [x] P3 DeviceSelector + bindingUtils (alias rule) + tests
- [x] P4 WaterHeaterIcon + registry
- [x] P5 Dashboard desktop + mobile + zone card + detail + routing
- [x] P6 Form + i18n FR/EN
- [x] P7 Docs
- [x] P8 Validation green (tsc/eslint/vitest, UI)
- [ ] P9 Manual verification on real WHD02 water heaters (pending — shadow/live)
