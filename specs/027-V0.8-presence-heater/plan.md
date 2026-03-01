# Implementation Plan: V0.8 Presence Heater

## Tasks

1. [ ] Add `"heater"` to EquipmentType in `types.ts`
2. [ ] Add `"heater"` to VALID_EQUIPMENT_TYPES in `equipment-manager.ts`
3. [ ] Create `src/recipes/presence-heater.ts` with slots, i18n, validate, start, stop
4. [ ] Register recipe in `src/recipes/engine/recipe-registry.ts`
5. [ ] Write tests: validation, comfort/eco toggle, night window, override, maxOnDuration, invertRelay
6. [ ] TypeScript compile check
7. [ ] Run all tests

## Dependencies

- Requires recipe engine (V0.8) — already implemented
- Reuses `isInTimeWindow()` helper from presence-thermostat or shared

## Testing

- Run `npx tsc --noEmit` — zero errors
- Run `npm test` — all tests pass
- Manual: create heater equipment with relay binding, instantiate recipe, verify relay toggles on motion
