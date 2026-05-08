# Plan — Spec 092

## Implementation steps

1. **Bootstrap repo**: copy structure from `sowel-recipe-motion-light` (package.json, tsconfig.json, .github/workflows/release.yml, .gitignore). Replace ids/names with `state-trigger-light`.

2. **Manifest** (`manifest.json`).

3. **Plugin code** (`src/index.ts`):
   - Type imports for RecipeContext / RecipeDefinition (copied from existing plugins).
   - `createRecipe()` that returns the slot definitions, i18n, validate, createInstance.
   - `validate(params, ctx)`: see Architecture.
   - `createInstance(params, ctx)`:
     - Resolve params (zone, trigger, stateValue, lightIds, durationMs, nightOnly).
     - Restore `expiresAt` from ctx.state if present.
     - Subscribe to `equipment.data.changed` for the trigger equipment, alias=state.
     - Subscribe to `equipment.data.changed` for each light (alias=state) to detect manual off.
     - Implement turn-on / turn-off / arm-timer / cancel-timer / restore-from-state.
     - Return `{ stop }`.

4. **Tests** (vitest) — see Test Plan below.

5. **Build** locally (`npm run build`) — check dist/ matches expected.

6. **Initial release**:
   - Create empty GitHub repo `mchacher/sowel-recipe-state-trigger-light`.
   - Push `main`, tag `v0.1.0` — GitHub Actions builds tarball and creates release.

7. **Add to registry**: bump `Sowel/plugins/registry.json` with the plugin entry.

8. **Validate**: install via UI in dev → bind a gate or contact equipment → check trigger fires.

## Test Plan

### Modules to test

- `state-trigger-light` plugin's `createInstance` behavior — tested at the recipe-instance level using the same Vitest harness as `sowel-recipe-motion-light` (mock RecipeContext: eventBus, equipmentManager, zoneAggregator, helpers, state).

### Scenarios

| Scenario                                                                                  | Expected                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Trigger event with value=stateValue, previous=other, lights off, night                    | Lights ON, offTimer armed, ctx.state.expiresAt set |
| Trigger event with value=stateValue, previous=stateValue (no change)                      | Nothing happens (filtered by `previous !== value`) |
| Trigger event with value!=stateValue                                                      | Nothing happens                                    |
| Trigger event, nightOnly=true, root.isDaylight=true                                       | Skipped                                            |
| Trigger event, nightOnly=true, root.isDaylight=null                                       | Treated as night → fires                           |
| Trigger event, nightOnly=false, daylight=true                                             | Fires                                              |
| Trigger event while at least one light already ON                                         | Skipped (no timer armed)                           |
| offTimer fires                                                                            | turnOffLights called, ctx.state.expiresAt cleared  |
| Manual light off during timer (light goes from ON to OFF, not via the recipe's own order) | offTimer cancelled, ctx.state.expiresAt cleared    |
| Restart with persisted expiresAt in the future                                            | offTimer armed for remainder                       |
| Restart with persisted expiresAt in the past                                              | turnOffLights fired once, state cleared            |
| Re-trigger during running timer                                                           | No-op (lights already on, timer untouched)         |
| Validate: trigger ∈ lights                                                                | Throws                                             |
| Validate: trigger has no `state` binding                                                  | Throws                                             |
| Validate: stateValue empty                                                                | Throws                                             |
| Validate: lights empty                                                                    | Throws                                             |

## Out of scope

- Brightness control (covered by future `state-trigger-light-dimmable`).
- "From → to" transitions.
- Daytime-only mode.
- Multiple state aliases (only `state`).
