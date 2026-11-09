# Architecture — Spec 198

## Flow

```
manifest.json (icon) ──► RecipeLoader.loadRecipe ──► RecipeManager.registerExternal(def, { icon })
                                                         │
                                                         ▼
                                     GET /api/v1/recipes  RecipeInfo { …, icon? }
                                                         │
                                                         ▼
useRecipes.recipes + instances ──► ZoneRecipesSection
                                     │  groupZoneInstances() → blocks (single | group)
                                     ├─► RecipeInstanceRow (variant "row")      ── click ─► journal (inline | BottomSheet)
                                     └─► RecipeGroup ─► RecipeInstanceRow (variant "child")       │
                                                                                     « Réglages » ┘
                                                                                          ▼
                                                                  RecipeSettings (dialog | full-screen page)
```

## Components

### Backend

- `src/shared/types.ts` — `RecipeInfo.icon?: string` (Lucide name, from the package manifest).
- `src/recipes/engine/recipe-manager.ts` — `registerExternal(definition, meta?: { icon?: string })` copies `meta.icon` into `info` only when it is a non-empty string.
- `src/recipes/recipe-loader.ts` — `loadRecipe` reads the installed manifest (`packageManager`) and passes `{ icon: manifest.icon }`.

### UI

- `ui/src/types.ts` — mirror `icon?: string` on `RecipeInfo`.
- New `ui/src/lib/recipe-icons.ts` — `RECIPE_ICONS` closed map (the registry's icons plus `ChefHat`), `recipeIcon(name?: string): LucideIcon`.
- New `ui/src/lib/recipe-rows.ts` — pure helpers:
  - `groupZoneInstances(instances)` → `Array<{ kind: "single"; instance } | { kind: "group"; recipeId; instances }>` keeping first-appearance order;
  - `isInstanceInAlarm(instance)` → `instance.enabled && instance.state?.alarm === true`;
  - `instanceContextLine(equipmentText, summary)` → the « equipment, summary » string (no (U+00B7)).
- New `ui/src/components/recipes/RecipeIconTile.tsx` — the 32 px tile with the optional alarm dot.
- New `ui/src/components/recipes/RecipeGroup.tsx` — group header + child rows.
- `ui/src/components/recipes/RecipeInstanceRow.tsx` — rewritten row: `variant: "row" | "child"`, clickable, switch alone, line 2 with pills, journal open state; the inline edit form and the action icons move out.
- New `ui/src/components/recipes/RecipeJournal.tsx` — the journal body (fetch + 5 s refresh, period groups) used inline and in the sheet; header with « Réglages ».
- New `ui/src/components/recipes/RecipeSettings.tsx` — the settings dialog / page: the existing field rendering moved out of `RecipeInstanceRow`, sections from `groupSlots`, rail, footer.
- `ui/src/components/recipes/ZoneRecipesSection.tsx` — renders blocks from `groupZoneInstances`.
- i18n `fr.json` / `en.json` — keys for « Réglages », « en alarme », group count, dialog labels.

## Files changed

| Domain  | File                                           | Change                              |
| ------- | ---------------------------------------------- | ----------------------------------- |
| Types   | `src/shared/types.ts`, `ui/src/types.ts`       | `RecipeInfo.icon?`                  |
| Recipes | `src/recipes/engine/recipe-manager.ts`         | `registerExternal` meta             |
| Recipes | `src/recipes/recipe-loader.ts`                 | pass the manifest icon              |
| UI lib  | `ui/src/lib/recipe-icons.ts`, `recipe-rows.ts` | new, pure, tested                   |
| UI      | `ui/src/components/recipes/*`                  | row, group, tile, journal, settings |
| Docs    | `docs/user/recipes.md`, technical pages EN/FR  | see spec docs delta                 |

## Delivery

Three stacked PRs in this repository, each shippable on its own, plus one in the recipe's repository:

1. Slice A — icon, two-line row, groups, alarm dot, clickable row opening today's log; « Réglages » opens today's inline form, which gains Dupliquer / Supprimer.
2. Slice B — the journal: period groups, sheet header naming the instance.
3. Slice C — the settings window and page replacing the inline form.
4. `sowel-recipe-state-watch` 3.1.0 (PR #5 there): summary without (U+00B7), alarm logged at `error`; then release and `chore(registry)` bump (maintainer's go).
