# V0.8b: Motion-Light Recipe Enhancements

## Summary

Improve the existing `motion-light` recipe with multi-light support, optional lux threshold, motion impulse reset, and a failsafe max-on duration.

## Reference

- Existing recipe: `src/recipes/motion-light.ts`
- Zone aggregator: `src/zones/zone-aggregator.ts` (already aggregates `luminosity` as average)

## Changes

### 1. Multi-light support

- The `light` slot becomes `lights`: a list of equipment IDs from the selected zone
- Accepts `light_onoff`, `light_dimmable`, and `light_color` equipment types
- All lights are turned on/off together
- Validation: all lights must belong to the selected zone and have a `state` order binding

### 2. Lux threshold (optional)

- New optional slot `luxThreshold` (type: `number`)
- If set and the zone's aggregated `luminosity` is above the threshold, motion does NOT trigger light-on
- If no luminosity sensor exists in the zone, the condition is ignored (lights turn on normally)

### 3. Reset timer on every motion event

- Current behavior: timer only starts when motion goes from `true` to `false`
- New behavior: every `zone.data.changed` event with `motion=true` resets (restarts) the timer
- This handles PIR sensors that send repeated impulses instead of continuous state

### 4. Failsafe max-on duration (optional)

- New optional slot `maxOnDuration` (type: `duration`, e.g. "2h")
- If set, lights are forced off after this duration, regardless of ongoing motion
- Protects against stuck sensors or permanent motion
- A log entry is written when failsafe triggers

## Acceptance Criteria

- [ ] `lights` slot accepts a list of equipment IDs (replaces single `light` slot)
- [ ] All listed lights must belong to the selected zone
- [ ] All listed lights must have a `state` order binding
- [ ] `light_onoff`, `light_dimmable`, and `light_color` types are accepted
- [ ] Optional `luxThreshold`: blocks light-on when zone luminosity > threshold
- [ ] Lux threshold ignored when no luminosity data available
- [ ] Every motion=true event restarts the off-timer
- [ ] Optional `maxOnDuration`: forces lights off after max duration
- [ ] Failsafe timer resets when lights are turned off (manually or by recipe)
- [ ] All existing tests updated, new tests for each feature
- [ ] Backward compatibility: existing instances with single `light` param still work (migration)

## Scope

### In Scope

- Recipe logic changes in `motion-light.ts`
- RecipeSlotDef type update to support list of equipments
- Test updates and new tests

### Out of Scope

- Brightness control (deferred to future "constant-light" recipe)
- Mode-based activation (handled externally by mode manager)
- UI changes for recipe configuration (separate task)

## Edge Cases

- Zone has no luminosity sensor → lux threshold is silently ignored
- Empty lights list → validation error
- One light in the list has no `state` order → validation error on that light
- maxOnDuration triggers while motion is still active → lights off, log warning, timer state cleared
- Light turned off manually during failsafe countdown → failsafe timer cancelled
