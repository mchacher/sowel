# 054 — Recipe Packages

## Summary

Add `type: "recipe"` support to the PackageManager (from spec 053). Create a **RecipeLoader** that loads recipe packages and registers them with RecipeManager. Externalize recipes as individual packages (one repo per recipe). Expose shared helpers via RecipeContext.

**Incremental approach**: start with **switch-light** only to validate the full pipeline. Remaining 5 recipes externalized in follow-up PRs.

## Prerequisites

- Spec 053 completed (PackageManager extracted, `type` field in manifests)

## Decisions

- **Helpers in RecipeContext** — `duration` and `light-helpers` exposed via `ctx.helpers` (no code duplication in packages)
- **i18n in manifest** — multilingual name/description in manifest.json for store display before install
- **Coexistence** — `registerExternal()` for external recipes + `register(RecipeClass)` for built-in (temporary, until all 6 are externalized)
- **No UI changes** — admin UI stays as-is for now (recipes appear alongside integrations in the store)

## Recipe Package Interface

A recipe package exports a **factory function** — no dependency on core base class:

```typescript
// sowel-recipe-switch-light/src/index.ts
export function createRecipe(): RecipeDefinition {
  return {
    id: "switch-light",
    name: "Switch Light",
    description: "Lights follow manual commands...",
    slots: [ /* RecipeSlotDef[] */ ],
    actions: [ /* RecipeActionDef[] — optional */ ],
    i18n: { fr: { name: "...", description: "...", slots: {...} } },

    validate(params, ctx) {
      // throw Error if invalid
    },

    createInstance(params, ctx) {
      // subscribe to events, set up timers, etc.
      // ctx includes: eventBus, equipmentManager, zoneManager, zoneAggregator, logger, state, log, helpers
      return {
        stop() { /* cleanup */ },
        onAction(action, payload) { /* optional */ },
      };
    },
  };
}
```

### Key Design Decisions

- **Factory function** (`createRecipe`) — same pattern as `createPlugin` for integrations
- **No base class** — recipe returns a plain object conforming to `RecipeDefinition` interface
- **`createInstance()`** replaces the current `start()` + class instance pattern — returns a `{ stop(), onAction?() }` handle
- **`ctx.helpers`** — shared utilities (turnOnLights, turnOffLights, isAnyLightOn, parseDuration, formatDuration, setLightsBrightness) injected via RecipeContext
- **Recipe IDs stay identical** — existing instances in SQLite continue to work

## RecipeContext.helpers

New `helpers` field added to RecipeContext:

```typescript
interface RecipeHelpers {
  turnOnLights(lightIds: string[], ctx: RecipeContext): string[];
  turnOffLights(lightIds: string[], ctx: RecipeContext): string[];
  isAnyLightOn(lightIds: string[], ctx: RecipeContext): boolean;
  setLightsBrightness(lightIds: string[], ctx: RecipeContext, brightness: number): string[];
  parseDuration(value: unknown): number;
  formatDuration(ms: number): string;
}
```

Built-in recipes can also use these helpers (optional refactor later).

## RecipeLoader

New file: `src/recipes/recipe-loader.ts`

```typescript
class RecipeLoader {
  constructor(
    private packageManager: PackageManager,
    private recipeManager: RecipeManager,
    private logger: Logger,
  ) {}

  async loadAll(): Promise<void> {
    const packages = this.packageManager.getInstalledByType("recipe");
    for (const pkg of packages) {
      // dynamic import of dist/index.js
      const definition = mod.createRecipe();
      this.recipeManager.registerExternal(definition);
    }
  }
}
```

## RecipeManager Adaptation

- New `registerExternal(definition: RecipeDefinition)` wraps factory definition into internal lifecycle
- Existing `register(RecipeClass)` stays for built-in recipes (temporary coexistence)
- On `init()`, both built-in and external recipes start their instances

## Manifest i18n

Recipe package manifest includes multilingual descriptions for the store:

```json
{
  "id": "switch-light",
  "type": "recipe",
  "name": "Switch Light",
  "description": "Lights follow manual commands — any button press toggles lights on/off",
  "icon": "ToggleRight",
  "author": "mchacher",
  "repo": "mchacher/sowel-recipe-switch-light",
  "version": "1.0.0",
  "tags": ["automation", "button", "light", "toggle"],
  "i18n": {
    "fr": {
      "name": "Lumière sur interrupteur",
      "description": "Les lumières suivent les commandes manuelles — un appui sur un bouton bascule les lumières on/off"
    }
  }
}
```

## Phase 1: switch-light (this PR)

### Scope

- RecipeDefinition interface in types.ts
- RecipeHelpers interface + implementation in RecipeContext
- RecipeLoader
- RecipeManager.registerExternal()
- `sowel-recipe-switch-light` repo + GitHub Actions release
- Remove built-in SwitchLightRecipe from core
- Add to registry.json
- Wire in index.ts

### Not in scope (follow-up PRs)

- 5 remaining recipes (motion-light, motion-light-dimmable, presence-heater, presence-thermostat, state-watch)
- Admin UI tabs for integrations vs recipes
- Remove Recipe base class (only after all 6 are external)

## Acceptance Criteria (Phase 1)

- [ ] `RecipeDefinition` + `RecipeHelpers` interfaces in `src/shared/types.ts`
- [ ] `RecipeLoader` loads recipe packages and registers with RecipeManager
- [ ] `RecipeManager.registerExternal()` wraps factory definitions
- [ ] `ctx.helpers` exposes light-helpers + duration utils
- [ ] `sowel-recipe-switch-light` repo created with GitHub Actions release
- [ ] Built-in `SwitchLightRecipe` removed from core + `src/index.ts`
- [ ] 3 existing switch-light instances continue to work (same IDs)
- [ ] `registry.json` includes switch-light with `type: "recipe"` + `i18n`
- [ ] TypeScript compiles, all tests pass, lint clean
- [ ] Manual test: button press toggles light via external recipe
