# 053 — Externalize Recipes as Plugins

## Summary

Migrate the 6 built-in recipe implementations from `src/recipes/` to external plugin repos. After this, the recipe engine (`src/recipes/engine/`) remains in core but all recipe logic is distributed as plugins.

## Current Built-in Recipes

| Recipe                | File                       | Description                                 |
| --------------------- | -------------------------- | ------------------------------------------- |
| motion-light          | `motion-light.ts`          | Turn on light on motion, off after timeout  |
| motion-light-dimmable | `motion-light-dimmable.ts` | Same with brightness control + time slots   |
| switch-light          | `switch-light.ts`          | Toggle light on button press                |
| presence-heater       | `presence-heater.ts`       | Control heater based on zone occupancy      |
| presence-thermostat   | `presence-thermostat.ts`   | Control thermostat based on zone occupancy  |
| state-watch           | `state-watch.ts`           | Watch equipment state, trigger notification |

## Approach

Two options:

- **A. One plugin per recipe** — very granular, 6 repos. Overkill for small recipes.
- **B. One "core recipes" plugin** — single `sowel-plugin-core-recipes` containing all 6. Simpler to maintain.

**Recommended: Option B** — a single `sowel-plugin-core-recipes` with all built-in recipes. Users install it to get the standard automation library. Community can create additional recipe plugins later.

## Recipe Plugin Architecture

The plugin system needs to support **recipe registration** in addition to device integrations. This may require extending the `PluginDeps` interface to expose recipe registration APIs.

```typescript
// Plugin exports
export function createPlugin(deps: PluginDeps): IntegrationPlugin & RecipeProvider {
  return {
    // IntegrationPlugin methods (mostly no-op for a recipe plugin)
    ...
    // RecipeProvider methods
    getRecipes(): RecipeDefinition[] { ... }
  };
}
```

## Acceptance Criteria

- [ ] Recipe plugin interface defined (how plugins register recipes)
- [ ] `sowel-plugin-core-recipes` repo created with all 6 recipes
- [ ] Recipe engine loads recipe definitions from plugins (not just built-in)
- [ ] Built-in recipe code removed from `src/recipes/` (only engine remains)
- [ ] Existing recipe instances continue to work after migration
- [ ] Pre-built tarball release via GitHub Actions
- [ ] Added to `plugins/registry.json`

## Open Questions

- Should the plugin manifest declare `type: "recipe"` vs `type: "integration"` to distinguish?
- How to handle recipe tests? Keep in Sowel core (they test the engine) or move to plugin?
- Migration: existing recipe instances reference recipe IDs — IDs must stay the same
