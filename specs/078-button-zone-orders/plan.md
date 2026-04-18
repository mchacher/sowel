# Spec 078 — Implementation Plan

## Task Breakdown

### Phase 1: Types

- [x] 1.1 Add `"zone_order"` to `ButtonEffectType` in `src/shared/types.ts`
- [x] 1.2 Mirror in `ui/src/types.ts`

### Phase 2: Backend

- [x] 2.1 Add `zone_order` case in `ButtonActionManager.executeEffect()` — inject `zoneManager` + call `executeZoneOrder()`
- [x] 2.2 Add `"zone_order"` to effectType validation in `src/api/routes/button-actions.ts`
- [x] 2.3 Write tests

### Phase 3: Frontend

- [x] 3.1 Modify `equipment_order` form: zone selector first, filter equipments by zone
- [x] 3.2 Add `zone_order` form: zone selector → group action → optional value
- [x] 3.3 Add translations (en + fr) for zone_order labels
- [x] 3.4 Handle editing existing bindings (pre-populate zone from equipment's zoneId for equipment_order)

### Phase 4: Validate

- [x] 4.1 `npx tsc --noEmit` (backend)
- [x] 4.2 `cd ui && npx tsc -b --noEmit` (frontend)
- [x] 4.3 `npx vitest run` (all tests pass)
- [x] 4.4 `npx eslint src/ --ext .ts` (zero errors)

## Test Plan

### Modules to test

- `button-action-manager` — new `zone_order` effect execution

### Scenarios

| Module                | Scenario                                           | Expected                                                                     |
| --------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| button-action-manager | zone_order effect dispatches to executeZoneOrder   | `executeZoneOrder` called with `[zoneId, ...descendantIds]`, orderKey, value |
| button-action-manager | zone_order with parametric value (setpoint)        | `executeZoneOrder` called with bodyValue from config                         |
| button-action-manager | zone_order with non-parametric order (allLightsOn) | `executeZoneOrder` called with undefined bodyValue                           |
| button-action-manager | zone_order with invalid zoneId                     | Logs error, does not throw                                                   |
| button-action-manager | existing equipment_order still works               | No regression — executeOrder called as before                                |
| button-action-manager | existing mode_activate still works                 | No regression                                                                |
