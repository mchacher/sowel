# Architecture — Spec 126

## Flow diagram

```
Recipe definition (external plugin)
  slots: [{ id, type: "select", options: [{value,label}...], defaultValue }]
  i18n.fr.slots[id].options = { value: "Libellé FR" }
        │
        ▼  getRecipes() passes slots verbatim
GET /api/v1/recipes ──► UI recipe form (ZoneRecipesSection.tsx)
        │                    └─ slot.type === "select" → <select> dropdown
        │                       label = recipeSlotOptionLabel(recipe, slot, value, lang)
        ▼
User picks an option → param value = option.value (string)
        │
        ▼  createInstance / updateInstance (existing path, JSON params)
RecipeManager.buildContext(instance)
  ctx.helpers.getSunlight() ──► SunlightManager.getSunlightData()
                                  { sunrise, sunset, isDaylight }   (spec 023)
        ▲
        └─ recipe also subscribes to existing `sunlight.changed` to re-sync daily
```

## Components

### Changed: `src/shared/types.ts`

- `RecipeSlotDef.type` union gains `"select"`.
- `RecipeSlotDef` gains `options?: { value: string; label: string }[]`.
- `RecipeSlotI18n` gains `options?: Record<string, string>` (option value → translated label).
- `RecipeHelpers` gains `getSunlight(): SunlightData`. (`SunlightData` already exists in `src/zones/sunlight-manager.ts`; re-export or mirror the `{ sunrise, sunset, isDaylight }` shape in `types.ts` to avoid a zones→shared import cycle — prefer declaring the return shape inline in `RecipeHelpers`.)

### Changed: `src/recipes/engine/recipe-manager.ts`

- Constructor receives `sunlightManager: SunlightManager`.
- The `helpers` object gains `getSunlight: () => this.sunlightManager.getSunlightData()` (arrow keeps the read lazy, so it is safe even though `sunlightManager` is assigned in the constructor body).

### Changed: `src/index.ts`

- Pass the already-constructed `sunlightManager` into `new RecipeManager(...)` (it is created at line ~209, before the RecipeManager at ~249).

### Changed: `ui/src/components/recipes/ZoneRecipesSection.tsx`

- Add a `slot.type === "select"` branch in BOTH slot-render chains (create form ~line 793-950, edit form ~line 1806-1946): a Tailwind-styled `<select>` listing `slot.options`, value-bound to the slot param, default from `defaultValue`.

### Changed: `ui/src/lib/recipe-i18n.ts`

- Add `recipeSlotOptionLabel(recipe, slot, value, lang)`: resolves `i18n[lang].slots[slot.id].options[value] ?? slot.options.find(o => o.value === value)?.label ?? value`.

### Unchanged (verified)

- `RecipeInfo` serialization (`recipe-manager.ts` `slots: definition.slots`) — `options` rides along for free.
- The recipe engine does no per-type slot-value validation, so `"select"` needs no engine validation change.
- `ZoneAggregator` / `SunlightManager` / `sunlight.changed` — untouched; `getSunlight` only reads.

## Data model

No SQLite schema change. Recipe instance params remain a JSON blob; a select value is a string. No migration.

## Events

None new. Recipes that need day-to-day sun re-sync use the existing `sunlight.changed` event.

## API

No new endpoints. `GET /api/v1/recipes` payload gains `options` on select slots (passed through from the recipe definition).

## Files changed

| Domain  | File                                               | Change                                                                                                 |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Core    | `src/shared/types.ts`                              | `RecipeSlotDef.type += "select"`, `options?`; `RecipeSlotI18n.options?`; `RecipeHelpers.getSunlight()` |
| Recipes | `src/recipes/engine/recipe-manager.ts`             | Receive `SunlightManager`; add `getSunlight` helper                                                    |
| Core    | `src/index.ts`                                     | Pass `sunlightManager` to `RecipeManager`                                                              |
| UI      | `ui/src/components/recipes/ZoneRecipesSection.tsx` | Render `select` slot as a dropdown (2 sites)                                                           |
| UI      | `ui/src/lib/recipe-i18n.ts`                        | `recipeSlotOptionLabel()` helper                                                                       |
| UI      | `ui/src/types.ts`                                  | Mirror `RecipeSlotDef`/`RecipeSlotI18n` additions if duplicated there                                  |
