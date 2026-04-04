# 054 — Recipe Packages

## Summary

Add `type: "recipe"` support to the PackageManager (from spec 053). Create a **RecipeLoader** that loads recipe packages and registers them with RecipeManager. Externalize the 6 built-in recipes as individual packages (one repo per recipe). Remove built-in recipe code from core. Update the admin UI to distinguish integrations from recipes.

## Prerequisites

- Spec 053 completed (PackageManager extracted, `type` field in manifests)

## Recipe Package Interface

A recipe package exports a **factory function** — no dependency on core base class:

```typescript
// sowel-plugin-motion-light/src/index.ts
export function createRecipe(): RecipeDefinition {
  return {
    id: "motion-light",
    name: "Motion Light",
    description: "Turn on light on motion, off after timeout",
    slots: [
      /* RecipeSlotDef[] */
    ],
    actions: [
      /* RecipeActionDef[] — optional */
    ],
    i18n: {
      /* optional */
    },

    validate(params, ctx) {
      // throw Error if invalid
    },

    createInstance(params, ctx) {
      // subscribe to events, set up timers, etc.
      // ctx = { eventBus, equipmentManager, zoneManager, zoneAggregator, logger, state, log }
      return {
        stop() {
          /* cleanup */
        },
        onAction(action, payload) {
          /* optional */
        },
      };
    },
  };
}
```

### Key Design Decisions

- **Factory function** (`createRecipe`) — same pattern as `createPlugin` for integrations
- **No base class** — recipe returns a plain object conforming to `RecipeDefinition` interface
- **`createInstance()`** replaces the current `start()` + class instance pattern — returns a `{ stop(), onAction?() }` handle
- **RecipeContext** injected by RecipeManager, unchanged from today
- **Recipe IDs stay identical** — existing instances in SQLite continue to work

## RecipeLoader

New file: `src/recipes/recipe-loader.ts`

```typescript
class RecipeLoader {
  constructor(
    private packageManager: PackageManager,
    private recipeManager: RecipeManager,
    private logger: Logger,
  ) {}

  /** Load all installed recipe packages and register with RecipeManager */
  async loadAll(): Promise<void> {
    const packages = this.packageManager.getInstalledByType("recipe");
    for (const pkg of packages) {
      const mod = await import(pkg.entryPoint);
      const definition = mod.createRecipe();
      this.recipeManager.registerExternal(definition);
    }
  }
}
```

## RecipeManager Adaptation

RecipeManager needs a new `registerExternal(definition: RecipeDefinition)` method that wraps the external definition into the internal recipe lifecycle (replaces the current `register(RecipeClass)` for external recipes).

The existing `register(RecipeClass)` can coexist during migration but will be removed once all recipes are external.

## Recipe Packages (6 repos)

| Package                            | Repo                                        | Recipe ID             | Current version |
| ---------------------------------- | ------------------------------------------- | --------------------- | --------------- |
| sowel-recipe-motion-light          | mchacher/sowel-recipe-motion-light          | motion-light          | 1.0.0           |
| sowel-recipe-motion-light-dimmable | mchacher/sowel-recipe-motion-light-dimmable | motion-light-dimmable | 1.0.0           |
| sowel-recipe-switch-light          | mchacher/sowel-recipe-switch-light          | switch-light          | 1.0.0           |
| sowel-recipe-presence-heater       | mchacher/sowel-recipe-presence-heater       | presence-heater       | 1.0.0           |
| sowel-recipe-presence-thermostat   | mchacher/sowel-recipe-presence-thermostat   | presence-thermostat   | 1.0.0           |
| sowel-recipe-state-watch           | mchacher/sowel-recipe-state-watch           | state-watch           | 1.0.0           |

### Naming Convention

- Repos: `sowel-recipe-<id>` (not `sowel-plugin-` — distinguishes recipe packages from integrations)
- Package IDs match existing recipe IDs exactly (migration safety)

### Manifest Example

```json
{
  "id": "motion-light",
  "name": "Motion Light",
  "type": "recipe",
  "description": "Turn on light on motion detection, off after timeout",
  "icon": "Lightbulb",
  "author": "mchacher",
  "repo": "mchacher/sowel-recipe-motion-light",
  "version": "1.0.0",
  "tags": ["automation", "motion", "light"]
}
```

### Shared Code

`motion-light` and `motion-light-dimmable` share a base (currently `motion-light-base.ts`). Two options:

- **A.** Duplicate the shared code in each package (simple, no shared dependency)
- **B.** Extract a `sowel-recipe-utils` package imported by both

**Recommended: A** — the shared code is ~200 lines. Duplication is simpler than managing a shared package for 2 consumers.

### Helper Utilities

`duration.ts` and `light-helpers.ts` are used by multiple recipes. Options:

- **A.** Copy into each recipe package that needs them
- **B.** Keep in core and have recipe packages import from a known path
- **C.** Publish as `sowel-recipe-utils` npm package

**Recommended: A** — keep each recipe self-contained. The utility code is small.

## Registry Update

Add all 6 recipe packages to `plugins/registry.json`:

```json
{
  "id": "motion-light",
  "type": "recipe",
  "name": "Motion Light",
  "description": "Turn on light on motion detection, off after timeout",
  "icon": "Lightbulb",
  "author": "mchacher",
  "repo": "mchacher/sowel-recipe-motion-light",
  "version": "1.0.0",
  "tags": ["automation", "motion", "light"]
}
```

## Admin UI Evolution

The current "Plugins" admin page shows only integrations. It needs to:

1. Rename to "Packages" (or keep "Extensions" / "Plugins" as user-facing name)
2. Add tabs or sections: **Integrations** | **Recipes**
3. Each section shows installed + available packages of that type
4. Recipe packages show: name, description, version, installed/available status
5. Install/update/uninstall actions work the same as integrations

## Migration

- **Data**: Zero migration needed — `recipe_instances.recipe_id` values stay identical
- **Code**: Remove from core: `src/recipes/motion-light.ts`, `motion-light-dimmable.ts`, `switch-light.ts`, `presence-heater.ts`, `presence-thermostat.ts`, `state-watch.ts`, `engine/motion-light-base.ts`, `engine/light-helpers.ts`, `engine/duration.ts`
- **Keep in core**: `src/recipes/engine/recipe-manager.ts`, `recipe.ts`, `recipe-state-store.ts`
- **Startup**: Recipe packages are loaded after PackageManager.loadAll(), before `recipeManager.init()`
- **First restart**: recipes auto-installed from registry (same as integration plugins)

## Acceptance Criteria

- [ ] `RecipeDefinition` interface defined in `src/shared/types.ts`
- [ ] `RecipeLoader` loads recipe packages and registers with RecipeManager
- [ ] `RecipeManager.registerExternal()` wraps factory definitions
- [ ] 6 recipe repos created with GitHub Actions release workflow
- [ ] All 6 recipes produce working pre-built tarballs
- [ ] Built-in recipe code removed from `src/recipes/` (only engine remains)
- [ ] Existing recipe instances continue to work (same IDs, no data migration)
- [ ] `registry.json` includes all 6 recipe packages with `type: "recipe"`
- [ ] Admin UI distinguishes integrations and recipes (tabs or sections)
- [ ] Install/update/uninstall works for recipe packages
- [ ] TypeScript compiles, all tests pass, lint clean

## Open Questions

- Should recipe tests stay in core (they test the engine) or move to recipe repos?
- Admin page naming: "Plugins", "Packages", or "Extensions"?
- Should motion-light and motion-light-dimmable share code (option B) or duplicate (option A)?
