# Implementation Plan — Spec 126

## Slices

### Slice A — Types (foundation)

- A.1 — `src/shared/types.ts`: add `"select"` to `RecipeSlotDef.type`; add `options?: { value: string; label: string }[]` to `RecipeSlotDef`.
- A.2 — `src/shared/types.ts`: add `options?: Record<string, string>` to `RecipeSlotI18n`.
- A.3 — `src/shared/types.ts`: add `getSunlight(): { sunrise: string | null; sunset: string | null; isDaylight: boolean | null }` to `RecipeHelpers`.

### Slice B — `getSunlight()` wiring (core)

- B.1 — `src/recipes/engine/recipe-manager.ts`: add `sunlightManager: SunlightManager` constructor param + field; add `getSunlight: () => this.sunlightManager.getSunlightData()` to the `helpers` object.
- B.2 — `src/index.ts`: pass `sunlightManager` to `new RecipeManager(...)`.

### Slice C — UI `select` slot + option i18n

- C.1 — `ui/src/lib/recipe-i18n.ts`: add `recipeSlotOptionLabel(recipe, slot, value, lang)` with the fallback chain.
- C.2 — `ui/src/components/recipes/ZoneRecipesSection.tsx`: render a `<select>` for `slot.type === "select"` in both the create and edit slot-render chains; bind value to the slot param, honour `defaultValue`, label options via C.1.
- C.3 — `ui/src/types.ts`: mirror the `RecipeSlotDef`/`RecipeSlotI18n` additions if the UI keeps its own copy.

### Slice D — Tests

- D.1 — Backend: `getSunlight` returns the injected sunlight data; a registered recipe with a `select` slot exposes `options` via `getRecipes()`.
- D.2 — UI: `recipeSlotOptionLabel` resolution (i18n hit, English-label fallback, raw-value fallback, missing-language fallback).

## Test Plan

### Modules to test

- `src/recipes/engine/recipe-manager.ts` — `getSunlight` helper wiring + `select` options serialization through `getRecipes()`.
- `ui/src/lib/recipe-i18n.ts` — `recipeSlotOptionLabel` pure resolver.

### Scenarios per module

| Module         | Scenario                                                | Expected                                                                                |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| recipe-manager | `ctx.helpers.getSunlight()` inside an instance          | returns the `SunlightManager.getSunlightData()` value `{ sunrise, sunset, isDaylight }` |
| recipe-manager | sun not computed yet (manager returns nulls)            | `getSunlight()` returns `{ null, null, null }`, no throw                                |
| recipe-manager | register a recipe with a `select` slot → `getRecipes()` | returned slot carries `type: "select"` and the full `options` array                     |
| recipe-manager | existing non-select recipes                             | unchanged `RecipeInfo` (retro-compat)                                                   |
| recipe-i18n    | option with FR i18n present                             | returns the FR label                                                                    |
| recipe-i18n    | option missing FR i18n                                  | falls back to the option's English `label`                                              |
| recipe-i18n    | option missing both i18n and label                      | falls back to the raw `value`                                                           |
| recipe-i18n    | unknown lang                                            | falls back to English `label`                                                           |

### Retro-compat

- Non-select slots and all existing recipes behave exactly as before (`getSunlight` is additive; `options` is optional and ignored by non-select slots).

## Validation Plan

- `npx tsc --noEmit` (backend) + `cd ui && npx tsc -b --noEmit` (UI) — zero errors.
- `npx vitest run` — all pass (incl. new D.1/D.2).
- `npx eslint src/ --ext .ts` + `cd ui && npx eslint .` — zero errors.
- Manual: side-load a throwaway recipe with a `select` slot on the test instance (localhost:3001), confirm the dropdown renders + persists, and that a recipe calling `ctx.helpers.getSunlight()` logs the current sunrise/sunset.

## Follow-up (out of scope here)

- `schedule-on-off` recipe v2 (own repo): per-boundary `select` (Fixed time / Sunrise / Sunset) + offset `number`, reading `ctx.helpers.getSunlight()` and re-arming on `sunlight.changed`, skipping a boundary on null-sun days. Will require a registry bump.

## Commit scope

`core` / `recipes` / `ui`.
