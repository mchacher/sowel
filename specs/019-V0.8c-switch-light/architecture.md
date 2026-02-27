# Architecture: V0.8c Switch Light

## Data Model Changes

### types.ts

Add `json` to `RecipeSlotDef.type` union:

```typescript
type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean" | "json";
```

No new database tables or columns needed — uses existing recipe_instances, recipe_state, recipe_log.

## Event Bus Events

### Events Consumed

- `equipment.data.changed` (category: `action`) — button press events
  - Filters by: equipmentId in configured buttons list, alias = "action"
  - Payload: value is action string like "single", "double", "long"

- `equipment.data.changed` (alias: `state`) — external light state changes
  - Filters by: equipmentId in configured lights list
  - Used for: cancel failsafe timer on external off

### Events Emitted

No new events — uses existing recipe.instance.\* events via RecipeManager.

## API Changes

None — uses existing recipe instance CRUD endpoints.

## File Changes

| File                                  | Change                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `src/shared/types.ts`                 | Add `"json"` to RecipeSlotDef type union                                  |
| `src/recipes/engine/duration.ts`      | **New** — extract `parseDuration()`, `formatDuration()` from motion-light |
| `src/recipes/engine/light-helpers.ts` | **New** — extract `isAnyLightOn()`, `turnOnLights()`, `turnOffLights()`   |
| `src/recipes/motion-light.ts`         | Refactor to import shared helpers                                         |
| `src/recipes/switch-light.ts`         | **New** — Switch Light recipe                                             |
| `src/recipes/switch-light.test.ts`    | **New** — unit tests                                                      |
| `src/index.ts`                        | Register SwitchLightRecipe                                                |

## Action Mapping Schema

```typescript
// ActionMapping: maps button equipment IDs to their action→behavior mappings
type LightAction = "toggle" | "turn_on" | "turn_off" | "brightness_up" | "brightness_down";

interface ActionMapping {
  [buttonEquipmentId: string]: {
    [actionValue: string]: LightAction;
    // e.g. "single" → "toggle", "double" → "turn_off", "long" → "brightness_up"
  };
}
```

## Behavior Flow

```
Button press (equipment.data.changed, alias: "action")
  → Is button in configured buttons list? No → ignore
  → Get action value (e.g. "single")
  → Lookup in actionMapping[buttonId][actionValue]
  → Not found? → debug log, ignore
  → Execute mapped LightAction:
      toggle      → isAnyLightOn? turnOff : turnOn
      turn_on     → turnOn all lights
      turn_off    → turnOff all lights
      brightness_up   → for each dimmable light: current + 25, clamp 254
      brightness_down → for each dimmable light: current - 25, clamp 0
  → If lights turned on + maxOnDuration set → start failsafe timer
  → If lights turned off → cancel failsafe timer

External light change (equipment.data.changed, alias: "state")
  → Light turned OFF → cancel failsafe timer
  → Light turned ON + maxOnDuration → start failsafe timer
```

## Shared Helpers Design

### duration.ts

```typescript
export function parseDuration(value: unknown): number;
export function formatDuration(ms: number): string;
```

### light-helpers.ts

```typescript
import type { RecipeContext } from "./recipe.js";

export function isAnyLightOn(lightIds: string[], ctx: RecipeContext): boolean;
export function turnOnLights(lightIds: string[], ctx: RecipeContext): string[]; // returns errors
export function turnOffLights(lightIds: string[], ctx: RecipeContext): string[]; // returns errors
```

These functions are stateless — they take lightIds and ctx, perform the operation, and return results. Timer management stays in the recipe itself.
