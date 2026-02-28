# Motion Light Split — Simple + Dimmable

## Summary

Split the single `motion-light` recipe into two distinct recipes to reduce complexity:

- **`motion-light`** (simple): For `light_onoff` — straightforward on/off control on motion.
- **`motion-light-dimmable`** (advanced): For `light_dimmable` / `light_color` — adds brightness presets, morning window, and brightness override detection.

Both recipes share a common abstract base class for maximum code reuse.

Additionally, add a **`disableWhenDaylight`** boolean option to both recipes, allowing them to suspend light activation during daytime hours (based on sunrise/sunset computed by SunlightManager).

## Acceptance Criteria

- [ ] `motion-light` recipe exists and only accepts `light_onoff` equipments
- [ ] `motion-light-dimmable` recipe exists and only accepts `light_dimmable` / `light_color` equipments
- [ ] Both recipes share a common base class (`MotionLightBase`)
- [ ] `disableWhenDaylight` slot works: lights don't turn on when `isDaylight === true`
- [ ] Daylight transition: if lights are on when daylight starts, normal timeout cycle finishes, then lights won't turn on again
- [ ] Existing DB instances with brightness params are migrated to `motion-light-dimmable`
- [ ] All existing tests still pass (refactored across both recipes)
- [ ] New daylight-specific tests pass

## Scope

### In Scope

- Abstract base class with shared motion/timer/override/lux/daylight logic
- Simple recipe for on/off lights
- Dimmable recipe for brightness-capable lights
- `disableWhenDaylight` option on both recipes
- DB migration for existing instances
- i18n for new recipe and daylight slot

### Out of Scope

- Daylight option on switch-light or presence-thermostat recipes
- UI changes (dynamic form already adapts to slot definitions)
- Changes to RecipeContext, recipe-manager, or light-helpers

## Edge Cases

- Existing `motion-light` instance with brightness params → migrated to `motion-light-dimmable`
- `disableWhenDaylight=true` but no home coordinates configured → isDaylight is null → treated as night (lights function normally)
- Daylight transitions mid-cycle: lights stay on until timeout, then won't reactivate
- Both luxThreshold and disableWhenDaylight can coexist (independent checks, user picks one in practice)
