# Architecture: Motion Light Split

## Class Hierarchy

```
Recipe (abstract)
  └─ MotionLightBase (abstract) — shared logic (~500 lines)
       ├─ MotionLightRecipe — simple on/off (~100 lines)
       └─ MotionLightDimmableRecipe — brightness + morning window (~200 lines)
```

## MotionLightBase — Shared Logic

Contains all common behavior:

- Zone motion event handling (`zone.data.changed`)
- Light state change handling (`equipment.data.changed` alias=state)
- Button handling + override mode management
- Off-timer management (start/cancel/persist)
- Failsafe timer management
- Lux threshold checking (isTooBright, isBrightEnoughToTurnOff)
- **NEW**: Daylight checking (`disableWhenDaylight` → reads `isDaylight` from ROOT_ZONE)
- syncLightsOnStart
- hasMotion helper

### Template Methods (overridden by subclasses)

- `protected doTurnOn(): void` — Simple: just turnOnLights. Dimmable: turnOnLights + setBrightness.
- `protected validateExtra(params, ctx): void` — Subclass-specific param validation.
- `protected startExtra(params, ctx): void` — Subclass-specific initialization (parse brightness, subscribe to brightness events).
- `protected stopExtra(): void` — Subclass-specific cleanup.
- `protected onLightChangedExtra(value): void` — Dimmable: no-op. (brightness override is separate listener)
- `protected abstract getLightTypeConstraints(): string[]` — Which equipment types are accepted.

### Daylight Logic

```typescript
private isDaytime(): boolean {
  if (!this.disableWhenDaylight) return false;
  const rootData = this.ctx.zoneAggregator.getByZoneId(ROOT_ZONE_ID);
  return rootData?.isDaylight === true;
  // null isDaylight → treated as night → recipe functions normally
}
```

Used in `onZoneChanged()` and `syncLightsOnStart()` to prevent turning on lights during daytime.

## File Changes

| File                                        | Change                                            |
| ------------------------------------------- | ------------------------------------------------- |
| `src/recipes/engine/motion-light-base.ts`   | **NEW** — Abstract base class                     |
| `src/recipes/motion-light.ts`               | Rewritten — simple subclass                       |
| `src/recipes/motion-light-dimmable.ts`      | **NEW** — dimmable subclass                       |
| `src/recipes/motion-light.test.ts`          | Refactored — simple recipe tests + daylight tests |
| `src/recipes/motion-light-dimmable.test.ts` | **NEW** — dimmable-specific tests                 |
| `src/index.ts`                              | Register `MotionLightDimmableRecipe`              |
| `ui/src/i18n/locales/fr.json`               | New translations                                  |
| `ui/src/i18n/locales/en.json`               | New translations                                  |
| `migrations/017_motion_light_split.sql`     | Migrate instances with brightness                 |

## No Changes Required

- `src/recipes/engine/recipe.ts` — Base class unchanged
- `src/recipes/engine/recipe-manager.ts` — Unchanged
- `src/recipes/engine/light-helpers.ts` — Unchanged
- `src/shared/types.ts` — No new types needed
- RecipeContext — No new dependencies
