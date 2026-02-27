# V0.8c: Switch Light Recipe

## Summary

Implement the "Switch Light" recipe — lights follow manual commands from buttons/switches, with no automatic motion trigger. This is the basic lighting recipe for rooms without PIR sensors, where users control lights via wall switches, remotes, or smart buttons.

Also extract shared helpers from `motion-light.ts` into reusable modules for all lighting recipes.

## Reference

- Spec: `specs/018-recipes-roadmap/spec.md` — Recipe 2: Switch Light
- Existing: `src/recipes/motion-light.ts` — Motion Light recipe (helpers to extract)

## Acceptance Criteria

- [ ] Shared duration helpers extracted to `src/recipes/engine/duration.ts`
- [ ] Shared light helpers extracted to `src/recipes/engine/light-helpers.ts`
- [ ] `motion-light.ts` refactored to use shared helpers (no behavior change)
- [ ] Motion Light tests still pass after refactoring
- [ ] `json` type added to `RecipeSlotDef` type union
- [ ] Switch Light recipe implemented with slots: zone, lights, buttons, actionMapping, maxOnDuration
- [ ] Action mapping supports: toggle, turn_on, turn_off, brightness_up, brightness_down
- [ ] Brightness step fixed at 25 (on 0-254 scale)
- [ ] brightness_up/brightness_down only applies to dimmable lights (light_dimmable, light_color)
- [ ] Failsafe maxOnDuration timer works correctly
- [ ] External light changes (manual off) cancel failsafe timer
- [ ] Recipe registered at startup in index.ts
- [ ] Comprehensive unit tests for Switch Light
- [ ] TypeScript compiles with zero errors

## Scope

### In Scope

- Extract shared helpers from motion-light.ts
- Implement Switch Light recipe
- Add `json` slot type to RecipeSlotDef
- Unit tests

### Out of Scope

- Constant Light Regulation module (deferred)
- Adding buttons to Motion Light recipe (deferred)
- UI changes for JSON action mapping editor (uses existing JSON text input)
- New API endpoints (uses existing recipe instance CRUD)

## Edge Cases

- Button sends unknown action not in mapping → ignore silently (debug log)
- brightness_up on a light_onoff equipment → skip (only apply to dimmable)
- brightness_up would exceed 254 → clamp to 254
- brightness_down would go below 0 → clamp to 0
- All lights already ON + toggle → turn all OFF
- All lights already OFF + toggle → turn all ON
- Mixed state (some on, some off) + toggle → turn all OFF (consistent behavior)
- Button equipment deleted while recipe running → log warning, skip that button
- Light equipment deleted while recipe running → log warning, skip that light
- Empty actionMapping → validation error
