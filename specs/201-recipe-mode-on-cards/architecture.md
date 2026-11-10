# Architecture — Spec 201

## Flow diagram

```
recipe package                       core (verbatim)                  UI
──────────────                       ───────────────                  ──
actions: [{ id: "set_mode",          RecipeInfo.actions  ──REST──▶   useRecipes.recipes
  type: "cycle",                                                       │
  stateKey: "currentMode",           recipe_state       ──WS───▶   useRecipes.instances (state)
  targets: ["thermostat"] }]         (recipe.instance.state.changed)   │
                                                                       ▼
ctx.state.set("currentMode", …)                         modesForEquipment(equipmentId, instances, recipes)
                                                                       │
                                                        ┌──────────────┴──────────────┐
                                                        ▼                             ▼
                                                  WidgetCard (computer)      MobileWidgetCard (phone)
                                                  <CardModePills/> under     <CardModePills/> under
                                                  the title block            the label and zone lines
```

No backend logic changes: `registerExternal` already copies `definition.actions` into `RecipeInfo` as they are.

## Components

### New: `ui/src/lib/recipe-target-modes.ts`

Pure function `modesForEquipment(equipmentId, instances, recipes)` returning `{ key, recipe, action, option }[]` following FR2 (enabled instance, cycle action with `targets`, target slot of type `equipment` holding the id, single or list, state value among the options; one entry per instance and action; order by instance `createdAt`, then action order).

### New: `ui/src/lib/recipe-mode-colors.ts`

`MODE_COLORS` and `DEFAULT_PILL_COLOR`, moved out of `ZoneDetailPage.tsx`, plus `modePillColors(value)`. The zone page and the card pill both read it.

### New: `ui/src/components/dashboard/CardModePills.tsx`

`CardModePills({ equipmentId, size })`: reads `useRecipes` (instances, recipes), memoises `modesForEquipment`, renders nothing when empty, else an absolutely placed row (`absolute left-0 top-full`, `pointer-events-none`) of pills labelled through `cycleOptionLabel`. `size` is `"md"` (computer, `text-micro`) or `"sm"` (phone, 10 px equivalent through the existing `text-micro` with tighter padding; no arbitrary font size, lint).

## Files changed

| Domain   | File                                                     | Change                                                                    |
| -------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Types    | `src/shared/types.ts`                                    | `RecipeActionDef.targets?: string[]`, documented                          |
| Types    | `ui/src/types.ts`                                        | Same field                                                                |
| UI lib   | `ui/src/lib/recipe-target-modes.ts` (+ test)             | New, FR2                                                                  |
| UI lib   | `ui/src/lib/recipe-mode-colors.ts`                       | New, colours moved from the zone page                                     |
| UI       | `ui/src/components/dashboard/CardModePills.tsx` (+ test) | New                                                                       |
| UI       | `ui/src/components/dashboard/WidgetCard.tsx`             | Title block becomes `relative`; `<CardModePills>` from the tile context   |
| UI       | `ui/src/components/dashboard/MobileWidgetCard.tsx`       | Label and zone wrapped in a `relative` block; `<CardModePills size="sm">` |
| UI       | `ui/src/pages/ZoneDetailPage.tsx`                        | Imports the moved colours                                                 |
| Docs     | `docs/user/dashboard{,.fr}.md`                           | Equipment widget paragraph                                                |
| Docs     | `docs/technical/recipe-development{,.fr}.md`             | New section                                                               |
| Docs     | `docs/technical/data-model/recipes.md`                   | Field                                                                     |
| Recipes  | `sowel-recipe-presence-thermostat` `src/index.ts`        | `targets: ["thermostat"]`, local `RecipeActionDef` type, patch release    |
| Recipes  | `sowel-recipe-smart-socket-heating` `src/index.ts`       | `targets: ["heaters"]`, patch release                                     |
| Registry | `plugins/registry.json`                                  | Two bumps after the releases (separate `chore(registry)` PR, spec 089)    |
