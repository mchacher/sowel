# Recipe Developer Guide

How to create a new recipe for Sowel.

## Architecture

A recipe is a reusable automation template. Users instantiate recipes with parameters (slots) to create running automation instances. Recipes are registered at engine startup and exposed via the REST API.

```
Recipe class (definition)
  -> RecipeManager.register()
    -> GET /api/v1/recipes -> UI shows available recipes
      -> User creates instance with params
        -> RecipeManager.createInstance() -> validate() -> start()
          -> Recipe subscribes to EventBus events and reacts
```

## Creating a Recipe

### 1. Create the file

Create `src/recipes/<recipe-name>.ts` extending the `Recipe` base class:

```typescript
import type { RecipeSlotDef, RecipeLangPack } from "../shared/types.js";
import { Recipe, type RecipeContext } from "./engine/recipe.js";

export class MyRecipe extends Recipe {
  readonly id = "my-recipe";
  readonly name = "My Recipe"; // English (fallback)
  readonly description = "What it does"; // English (fallback)
  readonly slots: RecipeSlotDef[] = [
    // ...see Slots section below
  ];
  override readonly i18n: Record<string, RecipeLangPack> = {
    // ...see Translations section below
  };

  validate(params: Record<string, unknown>, ctx: RecipeContext): void {
    // Throw if params are invalid
  }

  start(params: Record<string, unknown>, ctx: RecipeContext): void {
    // Subscribe to events, start timers
  }

  stop(): void {
    // Unsubscribe events, clear timers (must be idempotent)
  }
}
```

### 2. Register in index.ts

```typescript
import { MyRecipe } from "./recipes/my-recipe.js";
// ...
recipeManager.register(MyRecipe);
```

### 3. Write tests

Create `src/recipes/<recipe-name>.test.ts`. Follow the pattern in `motion-light.test.ts`:

- In-memory SQLite with migrations
- Fake timers (`vi.useFakeTimers()`)
- Mock integration registry capturing MQTT publishes
- Test validation, event handling, timer behavior, cleanup

## Slots

Slots define the parameters users configure when creating an instance.

```typescript
interface RecipeSlotDef {
  id: string; // Unique within recipe (e.g. "lights", "timeout")
  name: string; // English label (fallback)
  description: string; // English description (fallback)
  type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean";
  required: boolean;
  list?: boolean; // Allow multiple values (equipment lists)
  defaultValue?: unknown;
  constraints?: {
    equipmentType?: EquipmentType | EquipmentType[]; // Filter equipment selector
    min?: number;
    max?: number;
  };
}
```

**Common slot patterns:**

| Slot type   | UI control     | Value format                       |
| ----------- | -------------- | ---------------------------------- |
| `zone`      | Auto-filled    | Zone UUID                          |
| `equipment` | Dropdown/check | Equipment UUID (or UUID[] if list) |
| `duration`  | Numeric + min  | `"10m"`, `"30s"`, `"1h"`           |
| `number`    | Numeric input  | Numeric value                      |
| `time`      | Time picker    | `"HH:MM"` string (24h)             |
| `boolean`   | Toggle         | `true` / `false`                   |

## Translations (i18n)

Translations travel with the recipe, not in the platform locale files. This allows recipes to be hot-loaded without modifying `fr.json`/`en.json`.

### How it works

Each recipe defines an `i18n` record mapping language codes to translated names, descriptions, and slot labels:

```typescript
override readonly i18n: Record<string, RecipeLangPack> = {
  fr: {
    name: "Ma recette",
    description: "Ce qu'elle fait",
    slots: {
      lights: { name: "Lumieres", description: "Lumieres a controler" },
      timeout: { name: "Delai", description: "Delai avant extinction" },
    },
  },
  // Add more languages as needed
};
```

### Type definitions

```typescript
interface RecipeLangPack {
  name: string;
  description: string;
  slots?: Record<string, RecipeSlotI18n>; // Keyed by slot id
}

interface RecipeSlotI18n {
  name: string;
  description: string;
}
```

### Resolution in the UI

The frontend uses helpers from `ui/src/lib/recipe-i18n.ts`:

```typescript
recipeName(recipe, lang); // Recipe name with fallback
recipeDescription(recipe, lang); // Recipe description with fallback
recipeSlotName(recipe, slot, lang); // Slot name with fallback
recipeSlotDescription(recipe, slot, lang); // Slot description with fallback
```

Fallback chain: `i18n[lang].name -> recipe.name` (English embedded in class).

### Adding a new language

Add a new key to the `i18n` record in your recipe class. No platform files to modify.

## RecipeContext

The `ctx` object injected into `validate()` and `start()` provides:

| Property               | Type               | Purpose                                    |
| ---------------------- | ------------------ | ------------------------------------------ |
| `eventBus`             | `EventBus`         | Subscribe to typed events                  |
| `equipmentManager`     | `EquipmentManager` | Query equipment state, execute orders      |
| `zoneManager`          | `ZoneManager`      | Query zone definitions                     |
| `zoneAggregator`       | `ZoneAggregator`   | Query aggregated zone data                 |
| `state`                | `RecipeStateStore` | Persist key-value state (survives restart) |
| `log(msg, level?)`     | function           | Write to recipe execution log              |
| `notifyStateChanged()` | function           | Tell UI that state changed (timers)        |

## Shared Helpers

Reusable utilities in `src/recipes/engine/`:

| Module             | Exports                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `duration.ts`      | `parseDuration(value)`, `formatDuration(ms)`                                   |
| `light-helpers.ts` | `isAnyLightOn()`, `turnOnLights()`, `turnOffLights()`, `setLightsBrightness()` |

## Event Bus Events

Key events recipes typically subscribe to:

| Event                    | Payload                                                   |
| ------------------------ | --------------------------------------------------------- |
| `zone.data.changed`      | `{ zoneId, aggregatedData: { motion, luminosity, ... } }` |
| `equipment.data.changed` | `{ equipmentId, alias, value, category }`                 |

## Lifecycle

1. **Registration**: `recipeManager.register(MyRecipe)` -- creates a sample instance to extract metadata
2. **Instantiation**: User creates via API -> `validate()` -> persisted to SQLite -> `start()`
3. **Restore**: On engine restart, enabled instances are loaded from DB and `start()` is called
4. **Update**: `stop()` -> update params in DB -> `validate()` -> `start()` with new params
5. **Delete**: `stop()` -> removed from DB (cascades to state + logs)

## Existing Recipes

| ID             | Description                                            |
| -------------- | ------------------------------------------------------ |
| `motion-light` | Turn on lights on motion, off after timeout            |
| `switch-light` | Toggle lights on button press, optional failsafe timer |

## Checklist

- [ ] Recipe class extends `Recipe` with id, name, description, slots, i18n
- [ ] `validate()` checks all params, throws on error
- [ ] `start()` subscribes to events, stores unsubs
- [ ] `stop()` clears all timers and unsubscribes (idempotent)
- [ ] Registered in `src/index.ts`
- [ ] Tests written and passing
- [ ] `npx tsc --noEmit` passes
- [ ] French translations in `i18n` record
