# Implementation Plan: V0.8c Switch Light

## Tasks

1. [ ] Add `"json"` to RecipeSlotDef type union in `src/shared/types.ts`
2. [ ] Extract `parseDuration()` / `formatDuration()` into `src/recipes/engine/duration.ts`
3. [ ] Extract light helpers into `src/recipes/engine/light-helpers.ts` (isAnyLightOn, turnOnLights, turnOffLights)
4. [ ] Refactor `motion-light.ts` to use shared helpers
5. [ ] Verify Motion Light tests still pass
6. [ ] Implement `src/recipes/switch-light.ts` (validate, start, stop, event handlers, action dispatch)
7. [ ] Register SwitchLightRecipe in `src/index.ts`
8. [ ] Write comprehensive tests in `src/recipes/switch-light.test.ts`
9. [ ] Run full test suite + TypeScript compilation check

## Dependencies

- Requires V0.8 (Motion Light) — already done
- Requires button equipment type — already exists in types.ts

## Testing

### Unit tests to write

- Validation: zone exists, lights exist, buttons exist, actionMapping valid
- Validation: lights belong to zone, lights have state order binding
- Validation: buttons have action data binding
- Action: single press → toggle (on/off)
- Action: mapped to turn_on / turn_off
- Action: brightness_up / brightness_down on dimmable lights
- Action: brightness_up clamp at 254, brightness_down clamp at 0
- Action: brightness on light_onoff → skip (no-op)
- Action: unknown action value → ignored
- Action: unknown button → ignored
- Failsafe: maxOnDuration timer fires → lights off
- Failsafe: manual off → timer cancelled
- Toggle: mixed state → all off
- External: light turned off → failsafe cancelled
- Cleanup: stop() cancels all timers and subscriptions

### Manual verification

- Create button equipment with action data binding (Zigbee button)
- Create light equipments with state order binding
- Create Switch Light recipe instance with action mapping
- Press physical button → verify lights respond
- Verify brightness up/down works on dimmable lights
