# Recipe Developer Guide

How to create a new recipe for Sowel.

## Architecture

A recipe is a reusable automation template. Users instantiate recipes with parameters (slots) to create running automation instances.

Since specs 053/054, **recipes are external packages in their own GitHub repos** (e.g. `mchacher/sowel-recipe-schedule-on-off`) — nothing recipe-specific lives in the Sowel repo. A recipe package ships a `manifest.json` (`type: "recipe"`) and a compiled `dist/index.js` exporting a `createRecipe()` factory. The `RecipeLoader` imports it at startup and registers the returned definition.

```
Recipe package (GitHub repo, released as sowel-recipe-<id>-<version>.tar.gz)
  -> PackageManager installs -> RecipeLoader imports dist/index.js
    -> createRecipe(): RecipeDefinition -> RecipeManager.registerExternal()
      -> GET /api/v1/recipes -> UI shows available recipes
        -> User creates instance with params
          -> validate() -> createInstance() returns { stop }
            -> Recipe subscribes to EventBus events and reacts
```

Distribution follows the same conventions as integration plugins (release tarball, registry entry or personal source) — see [plugin-development.md](plugin-development.md#publishing-and-versioning). For your own instance, the fastest loop is a **personal source** (spec 136): add your repo on the Plugins page, install through the TOFU confirmation, publish a release per iteration. The Sowel repo also ships a Claude Code skill, `sowel-recipe-dev`, that walks through this whole guide.

## Creating a Recipe

### 1. Scaffold the package repo

Repo naming: `sowel-recipe-<id>`. Layout:

```
sowel-recipe-<id>/
  manifest.json        # id, type: "recipe", name, version, icon, repo, i18n, sowelVersion
  package.json         # "type": "module", scripts: build / test
  tsconfig.json        # module + moduleResolution: "NodeNext", outDir dist
  src/index.ts         # exports createRecipe()
  src/index.test.ts    # vitest
```

The manifest `repo` field must equal the GitHub repo the package is served from, and the `id` must not collide with a registry entry (both enforced at install since spec 136).

### 2. Export the factory

Recipe packages never import Sowel core — they mirror the few types they need (copy them from `src/shared/types.ts`: `RecipeDefinition`, `RecipeSlotDef`, `RecipeInstanceHandle`) and export a factory:

```typescript
export function createRecipe(): RecipeDefinition {
  return {
    id: "my-recipe",
    name: "My Recipe", // English (fallback)
    description: "What it does",
    slots: [
      // ...see Slots section below
    ],
    i18n: {
      // ...see Translations section below
    },
    validate(params, ctx) {
      // Throw with a clear message if params are invalid
    },
    createInstance(params, ctx) {
      // Subscribe to events, arm timers...
      return {
        stop() {
          // Clear every timer, unsubscribe everything (must be idempotent)
        },
      };
    },
  };
}
```

`RecipeManager` calls `createInstance()` per running instance; the returned handle's `stop()` is invoked on disable, param update (stop -> validate -> createInstance), recipe update, and shutdown.

### 3. Write tests

Create `src/index.test.ts` in the recipe repo (vitest). Follow the pattern of `sowel-recipe-schedule-on-off`:

- Build a fake `ctx` (log, state, eventBus with capture, equipment accessors)
- Fake timers (`vi.useFakeTimers()`)
- Test validation, event handling, timer behavior, and that `stop()` cleans everything

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
    crossZone?: boolean; // Allow picking equipments from any zone
    includeDescendants?: boolean; // Widen candidates to descendant zones
  };
}
```

### Equipment slot scope: `crossZone` and `includeDescendants`

By default, an `equipment` slot's picker is filtered to equipments that live in the recipe's `zone`. Two constraints widen that set:

| Constraint           | Effect                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crossZone`          | Lets the user pick an equipment from **any** zone in the system. Useful for triggers like "the gate" that semantically belong to a different zone than the action.  |
| `includeDescendants` | Widens the candidate set to the recipe zone **plus all descendant zones**. Useful when the actuators (e.g. lights) live in subzones rather than directly in `zone`. |

The two flags are independent: `crossZone` ignores zone scope entirely, while `includeDescendants` keeps the zone-rooted scope but recursively includes children. A picker with both set behaves like `crossZone` alone.

```typescript
slots: RecipeSlotDef[] = [
  { id: "zone", name: "Zone", description: "...", type: "zone", required: true },
  {
    id: "trigger",
    name: "Trigger equipment",
    description: "Equipment whose state change fires the recipe",
    type: "equipment",
    required: true,
    constraints: { crossZone: true }, // can be in another zone
  },
  {
    id: "lights",
    name: "Lights",
    description: "Lights to turn on",
    type: "equipment",
    required: true,
    list: true,
    constraints: {
      equipmentType: ["light_onoff", "light_dimmable"],
      includeDescendants: true, // lights may live in subzones of `zone`
    },
  },
];
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
| `select`    | Dropdown       | chosen option `value` (string)     |

**`select` slot (spec 126).** Provide `options: { value: string; label: string }[]`; `label` is the English fallback. Per-language option labels live in the recipe's i18n under `slots[<id>].options[<value>]`. The chosen option's `value` is stored as the param. Use it for a small closed list of named choices (e.g. "fixed time / sunrise / sunset").

**Conditional visibility (spec 126).** Any slot can declare `hiddenWhen: { slot: "<otherSlotId>", equals: <value | value[]> }`. The recipe form hides that slot (removes it from the layout, keeping the remaining fields aligned) when the referenced sibling's effective value (its param, or its `defaultValue` when untouched) matches. Pairs naturally with a `select`: e.g. a fixed-time picker `hiddenWhen` the kind select is `["sunrise", "sunset"]`, and an offset `hiddenWhen` it is `"time"`, so only the relevant field shows.

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

The `ctx` object injected into `validate()` and `createInstance()` provides:

| Property           | Type               | Purpose                                                                   |
| ------------------ | ------------------ | ------------------------------------------------------------------------- |
| `eventBus`         | `EventBus`         | Subscribe to typed events                                                 |
| `equipmentManager` | `EquipmentManager` | Query equipment state, execute orders                                     |
| `zoneManager`      | `ZoneManager`      | Query zone definitions                                                    |
| `zoneAggregator`   | `ZoneAggregator`   | Query aggregated zone data                                                |
| `state`            | `RecipeStateStore` | Persist key-value state (survives restart, auto-notifies UI on mutations) |
| `log(msg, level?)` | function           | Write to recipe execution log                                             |

## Shared Helpers

Recipe packages reach shared utilities through `ctx.helpers` (the `RecipeHelpers` interface in `src/shared/types.ts`):

| Helper                                                                         | Purpose                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `parseDuration(value)`, `formatDuration(ms)`                                   | `"10m"` / `"30s"` style duration handling      |
| `isAnyLightOn()`, `turnOnLights()`, `turnOffLights()`, `setLightsBrightness()` | Light orchestration over equipment ids         |
| `getSunlight()`                                                                | Sun-aware scheduling (spec 126) — see below    |
| `getTariff()`                                                                  | Tariff-aware scheduling (spec 138) — see below |

`getSunlight(): { sunrise, sunset, isDaylight }` returns the current sun times (`"HH:MM"`, spec 023 offsets applied). Pair it with the `sunlight.changed` event to re-sync across days; fields are `null` when sun times are not yet computed or no home coordinates are configured.

### `getTariff()` — off-peak hours, read-only

`getTariff(): { configured, offPeakToday, isOffPeakNow }` returns the HP/HC schedule the user configured under **Settings → Administration → Energy tariff**, so a load-shifting recipe (water heater, pool pump, EV charger) does not have to ask for hours the instance already knows.

```typescript
const tariff = ctx.helpers.getTariff();
if (tariff.configured && tariff.offPeakToday.length > 0) {
  // [{ start: "22:00", end: "06:00", tariff: "hc" }, ...] — slots whose `end`
  // is not after their `start` wrap past midnight.
  const { start, end } = tariff.offPeakToday[0];
} else {
  // Nothing configured — fall back to the recipe's own time slots.
}
```

Three properties are worth relying on:

- **Read-only by construction.** Each call builds a fresh object copied out of the `TariffClassifier` cache. A recipe cannot reach, alias, or mutate the schedule that energy billing runs on, and there is no setter.
- **Prices are not exposed.** Knowing _when_ energy is cheap is enough to schedule a load; what it costs is commercial data, and a recipe package is third-party code that can republish whatever it is handed. `offPeakToday` carries the schedule and nothing else.
- **Always answer for the unconfigured case.** `configured` is `false` on a fresh instance and on any instance whose owner never filled the tariff page. Treat the recipe's own slots as the fallback rather than refusing to run.

`offPeakToday` reflects the current local day-of-week: a schedule that only covers weekdays yields an empty list on Sunday. Re-read it rather than caching it at start.

## Event Bus Events

Key events recipes typically subscribe to:

| Event                    | Payload                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `zone.data.changed`      | `{ zoneId, aggregatedData: { motion, luminosity, ... } }`                                                 |
| `equipment.data.changed` | `{ equipmentId, alias, value, category }`                                                                 |
| `sunlight.changed`       | (no payload) — sun times recomputed (new day / daylight transition); read via `ctx.helpers.getSunlight()` |

## Lifecycle

1. **Load**: `RecipeLoader.loadAll()` imports each installed, enabled recipe package (`dist/index.js`) and registers `createRecipe()`'s definition with `RecipeManager.registerExternal()`
2. **Instantiation**: user creates via API -> `validate()` -> persisted to SQLite -> `createInstance()`
3. **Restore**: on engine restart, enabled instances are loaded from DB and `createInstance()` is called
4. **Param update**: `stop()` -> update params in DB -> `validate()` -> `createInstance()` with new params
5. **Recipe update**: new package version installed -> definition re-registered -> running instances are restarted so they execute the new version (issue #349)
6. **Delete**: `stop()` -> removed from DB (cascades to state + logs)

## Existing Recipes

The live catalog is `plugins/registry.json` in the Sowel repo (every `"type": "recipe"` entry, one GitHub repo each). Good exemplars to copy from:

| Repo                           | Demonstrates                                                            |
| ------------------------------ | ----------------------------------------------------------------------- |
| `sowel-recipe-schedule-on-off` | Timers, sun-aware boundaries (`getSunlight`), select slots, i18n, tests |
| `sowel-recipe-state-watch`     | Generic data-key watch raising alarms                                   |
| `sowel-recipe-motion-light`    | Classic sensor to actuator pattern with timeout                         |

## Checklist

- [ ] External repo `sowel-recipe-<id>` with `manifest.json` (`type: "recipe"`, `repo` matching the GitHub repo) and `dist/index.js` exporting `createRecipe()`
- [ ] Definition carries id, name, description, slots, i18n (FR + EN)
- [ ] `validate()` checks all params, throws on error
- [ ] `createInstance()` subscribes to events, stores unsubs; triggers are edge-guarded (`equipment.data.changed` re-fires with unchanged values — track the last-seen value and react on real transitions only)
- [ ] `stop()` clears all timers and unsubscribes (idempotent)
- [ ] Tests written and passing in the recipe repo (`npm test`), `npm run build` clean
- [ ] Release tarball `sowel-recipe-<id>-<version>.tar.gz` attached to the `v<version>` GitHub release, manifest version matching the tag
- [ ] Installed and exercised on a live instance through a personal source (spec 136) or a registry entry
