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

## Dashboard tile (spec 169)

A recipe can offer a **tile on the Dashboard**, next to the equipment widgets it acts on. It is opt-in: a definition without `tile` is never listed in the widget picker and cannot be pinned. Most recipes have nothing worth watching at a glance and should declare nothing.

```typescript
export function createRecipe(): RecipeDefinition {
  return {
    id: "delivery-gate",
    // ...
    actions: [{ id: "set_mode", type: "cycle", stateKey: "mode", options: [...] }],
    tile: {
      icon: "Truck",              // key from the tile icon set (below)
      summaryKey: "summary",      // default; omit to use it
      countdownKey: "timerExpiresAt", // default; omit to use it
      actions: ["set_mode"],      // which of your actions get a control
      confirm: true,              // this tile moves something physical (spec 171)
      confirmParam: "confirmFromDashboard", // ...unless the user says otherwise
      confirmFrom: "gate",        // ...or unless the equipment itself has an answer
    },
  };
}
```

### What the tile renders

Everything comes from **instance state** your recipe writes with `ctx.state.set()`, and every element is optional — a key your state does not carry renders nothing rather than an empty slot.

| Element     | Source                                                 | Notes                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Icon        | `tile.icon`                                            | Closed set: `ChefHat`, `Clock`, `DoorClosed`, `Droplets`, `Fan`, `Flame`, `Lightbulb`, `Snowflake`, `Sun`, `Thermometer`, `Timer`, `Truck`, `Waves`, `Zap`. An unknown key falls back to `ChefHat`. |
| Title       | the widget label, else your recipe's localized name    | The user can rename a tile; their label wins.                                                                                                                                                       |
| Status line | `state[tile.summaryKey ?? "summary"]`                  | A short string. Keep it under ~40 characters — a tile is ~240 px wide.                                                                                                                              |
| Countdown   | `state[tile.countdownKey ?? "timerExpiresAt"]`         | An **ISO-8601 instant**. The UI ticks it down each second and hides it once passed.                                                                                                                 |
| Controls    | the `tile.actions` ids, matched against your `actions` | Rendered as the same pill the recipe row shows. An id you do not declare in `actions` is skipped.                                                                                                   |

These are the same three state keys the recipe row already renders on the zone page, so a recipe that publishes them gets a coherent presentation on both surfaces.

```typescript
// Inside createInstance — what makes the tile live.
ctx.state.set("summary", `Ouvert pour le livreur — refermeture à ${hhmm}`);
ctx.state.set("timerExpiresAt", new Date(Date.now() + holdMs).toISOString());
ctx.state.set("mode", "short"); // the stateKey your cycle action reads
```

Publish the resting value of a cycle action's `stateKey` from the start of `createInstance`, not only when something happens: the control does not render while its state key is absent, so a tile whose recipe is idle would show no button at all.

### A click on the tile fires its control (spec 171)

When a tile renders **exactly one** control, a click anywhere on the card fires it — the same cycle, the same next value as the pill, which stays where it is for anyone who prefers to aim. Two controls and the card stays inert: it would have to guess which one you meant. So does a tile with no control at all, a disabled instance, and a Dashboard in edit mode.

`confirm: true` says that firing this tile **moves something physical** — a gate, a door, a pump. On the mobile Dashboard the card then opens a slide-to-confirm sheet naming the position it is about to switch to, instead of actuating on a tap; on desktop it fires directly, a mouse click being deliberate enough. The pill is never guarded: a 10 px target is already an aim, and this is the same call spec 146 made for gate equipment.

`confirmParam` names one of your **`boolean` slots**, and hands that choice to the user — the recipe's equivalent of the confirmation toggle a gate equipment carries. Whatever the instance answers wins; `confirm` is only the default for an instance that was never asked, so adding the slot to an existing recipe never silently drops the guard on the instances already running.

**`confirmFrom` is the one to reach for first.** It names one of your **`equipment` slots** — the equipment the tile's single control actuates. When that slot resolves, **that equipment's own "Confirmation before action" (spec 146) decides, and `confirm` and `confirmParam` are not consulted at all.**

That is not a precedence detail, it is the point: without it, the same physical gate is asked about in three places, and two of them can disagree. Somebody turns the guard on for their Portail equipment and still gets a recipe tile that fires on a tap. With `confirmFrom`, the answer is given **once, on the equipment**, and every surface that actuates it asks the same question.

Only your recipe knows whether such a derivation is meaningful — an action touching several equipments, or none directly, or doing more than an equipment's own order cannot derive anything — which is why this is a declaration and not something the core infers. When you name no slot, or the slot does not resolve (the user left it empty, the equipment was deleted), `confirmParam` and then `confirm` decide as before. An unresolvable slot is **never** read as "do not ask".

```typescript
// A slot the user can untick, and a tile that reads it.
slots: [
  {
    id: "confirmFromDashboard",
    name: "Confirm before acting from the Dashboard",
    description: "On a phone, ask for a slide before the tile opens the gate.",
    type: "boolean",
    required: false,
    defaultValue: true,
  },
],
tile: { icon: "Truck", actions: ["set_mode"], confirm: true, confirmParam: "confirmFromDashboard" },
```

```typescript
// Better, when the tile's control actuates one equipment your recipe already
// takes as a slot: the user answers once, on the gate, for every surface.
slots: [{ id: "gate", name: "Gate", type: "equipment", required: true, /* ... */ }],
tile: { icon: "Truck", actions: ["set_mode"], confirm: true, confirmFrom: "gate" },
```

Declare `confirm` on a tile whose action opens something, and leave all three out for a tile that only picks a comfort mode. A core older than 1.66 ignores the fields, as it ignores every part of a `tile` it does not know.

### Rules worth knowing

- The tile follows the instance live over the `recipe.instance.state.changed` event — no polling, nothing to declare.
- A **disabled instance** renders greyed with its controls suppressed. It is not hidden: a user who disabled a recipe should see why the tile went quiet.
- Removing `tile` in a later version does **not** delete a user's widget; it renders as unavailable. Removing it is therefore a user-visible change, worth a release note.
- The tile shows state; it does not configure. Parameters stay on the zone page.

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
| `energy.claimCapacity()` / `energy.getCapacityState()`                         | Solar-surplus claims (spec 140) — see below    |

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

### `energy` — surplus capacity claims (spec 140)

Recipes never read the grid meter to decide whether to consume: one core
arbiter is the single meter reader, does reservation accounting, and allocates
the surplus in the **user's** priority order. A recipe expresses a need and
reacts to callbacks:

```typescript
const claim = ctx.helpers.energy?.claimCapacity({
  equipmentId: pumpId,
  watts: 600, // sizes the engage decision only
  // Omit `toleratedImportW`: since core 1.50 (#550) the surplus-import
  // tolerance is a property of the equipment (its energy profile's
  // "Tolerated import (W)"), set once by the user and read by the arbiter.
  // Pass it here only to override the profile for a specific claim.
  slack: "none", // "some"/"high" steps DOWN the user's list, never up
  note: "filtration on surplus",
  onGranted: () => pumpOn(),
  onRevoked: (reason) => pumpOff(), // a comfort-class recipe drops its surplus boost instead of switching off
});
// later: claim.release() when the need disappears
```

`claimCapacity` returns a handle (`status()`, `deniedReason`, `release()`, `reportNeed()`).
Denials are typed: `not-profiled`, `equipment-already-claimed`,
`arbiter-disabled`, `override-active`. `energy.getCapacityState()` is a
read-only snapshot (`enabled`, `availableSurplusW`, `grants`). `availableSurplusW`
is the true signed grid balance in watts (positive = exporting/surplus, negative
= importing/deficit), not a reservation total, so it dips as your own granted
load draws.

Rules for authors (spec 140, enforced socially and audited by the core):

1. **Report whether your load needs current** (spec 166). While your claim is
   granted, call `claim.reportNeed(true | false)` on every evaluation tick and
   again from `onGranted`. You own what your load is meant to be doing; the
   arbiter should not have to infer intent from electricity, and for a load with
   no power measurement of its own this is the only way the arbitration surface
   can show it at rest rather than permanently "granted". The declaration is
   consulted only for a grant no measurement has ever described: a fresh reading
   always wins, because it says what the appliance DOES while you say what you
   WANT. It is scoped to one grant, so a revoke drops it and you must report
   again after the next `onGranted`.

2. **A claim is a bonus, never a plan.** Keep a standalone fallback (tariff
   windows, schedules, thresholds): it is your behavior on older cores
   (`ctx.helpers.energy === undefined`), when the arbiter is disabled, after
   `meter-stale`, and on the many homes with **no solar production** — where
   tariff-only is a complete mode, never a degraded one.
3. **Act on callbacks immediately.** The reservation is freed at revocation;
   not honoring a revoke is detected (`revoke-not-honored`) and the equipment
   is temporarily excused as background.
4. **Never read the grid meter** to decide whether to consume when a claim is
   possible — private meter logic reintroduces the oscillation the arbiter
   removes.
5. **`release()` when the need disappears** — the watts belong to the next
   load in the list.
6. **Hard-quota loads**: when your deadline forces you to run without a
   grant, run — but keep the claim open while you do. A grant landing on an
   already-running load makes the arbiter's books exact, and the journal
   shows an `unclaimed-run` entry instead of a mystery hole in the surplus.

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
