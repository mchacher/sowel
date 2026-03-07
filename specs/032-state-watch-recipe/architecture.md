# Architecture: StateWatch Recipe

## Overview

A new Recipe implementation following the existing pattern (extends Recipe base class). No database changes, no new API routes — recipes are already fully managed by RecipeManager.

## File Structure

```
src/recipes/
  state-watch.ts          # New: StateWatch recipe implementation
```

## Recipe Registration

In `src/index.ts`, add:

```typescript
import { StateWatchRecipe } from "./recipes/state-watch.js";
recipeManager.register(StateWatchRecipe);
```

## Slot Definitions

| Slot           | type      | required | constraints                        |
| -------------- | --------- | -------- | ---------------------------------- |
| zone           | zone      | yes      | —                                  |
| equipment      | equipment | yes      | equipmentType: any (no constraint) |
| dataKey        | text      | yes      | —                                  |
| watchValue     | text      | yes      | —                                  |
| delay          | duration  | no       | min: "0s"                          |
| repeatInterval | duration  | no       | min: "1m"                          |
| checkTime      | time      | no       | —                                  |

## State Keys (persisted in recipe_state)

| Key              | Type         | Description                                       |
| ---------------- | ------------ | ------------------------------------------------- |
| `alarm`          | boolean      | Currently in alarm                                |
| `alarmSince`     | string (ISO) | When alarm was first raised                       |
| `alarmCount`     | number       | Total state.changed emissions since alarm started |
| `currentValue`   | unknown      | Last observed value                               |
| `watchStartedAt` | string (ISO) | When value entered watched state (for delay calc) |

## Timer Management

Three independent timers managed in memory:

| Timer         | Type       | Lifecycle                                                                         |
| ------------- | ---------- | --------------------------------------------------------------------------------- |
| `delayTimer`  | setTimeout | Started when value enters watched state; cleared on value exit or alarm trigger   |
| `repeatTimer` | setTimeout | Started after delay expires (or immediately if no delay); cleared on value exit   |
| `checkTimer`  | setTimeout | Scheduled for next occurrence of checkTime; always running while recipe is active |

### checkTime scheduling

```typescript
function msUntilNextOccurrence(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}
```

## Value Comparison

String coercion for comparison: `String(currentValue) === String(watchValue)`

This handles:

- `"open" === "open"` (string)
- `true` vs `"true"` (boolean stored as string in params)
- `1` vs `"1"` (number)

## Event Subscriptions

| Event                    | Handler                                                 |
| ------------------------ | ------------------------------------------------------- |
| `equipment.data.changed` | Check if equipmentId and dataKey match → evaluate state |

## i18n

Provide `fr` and `en` translations for recipe name, description, and slot labels.

## File Changes

| File                         | Change                                |
| ---------------------------- | ------------------------------------- |
| `src/recipes/state-watch.ts` | New: StateWatch recipe implementation |
| `src/index.ts`               | Register StateWatchRecipe             |

No migration, no API changes, no UI changes — existing recipe UI handles all recipe types generically.
