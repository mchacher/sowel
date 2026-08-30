# Spec 169 — Implementation plan

## Steps

Order follows the skill's rule: types → DB → domain → tests → API → UI.

- [x] **1. Types** — `RecipeTileDef`, `RecipeDefinition.tile`, `RecipeInfo.tile`, `DashboardWidget.type` widened + `recipeInstanceId`, in `src/shared/types.ts`. Mirror into `ui/src/types.ts`.
- [x] **2. Migration** — `migrations/029_dashboard_recipe_widget.sql`, table recreate (architecture §2), covered by `src/core/migration-029-dashboard-widgets.test.ts`: applied to a database that already holds one widget of each existing type, inside a transaction, foreign keys on. That is a stronger check than eyeballing a copy of one real database, and it runs on every CI.
- [x] **3. Recipe manager** — `registerExternal` copies `tile` into `RecipeInfo`, one line beside the `actions` spread (`recipe-manager.ts:155`).
- [x] **4. Route** — `dashboard.ts`: third enum value, `recipeInstanceId` property, the `if`/`then` branch, existence + eligibility checks in the handler, `recipe_instance_id` in the INSERT and in `rowToWidget`. `registerDashboardRoutes` gains `recipeManager` (`server.ts:374`).
- [x] **5. Server tests** — the scenarios below in `dashboard.test.ts`.
- [x] **6. `RecipeTile`** — new component reusing `CountdownTimer` and `ModeCyclePill`; desktop and mobile densities; unavailable state.
- [x] **7. Wiring** — `WidgetGrid.WidgetContent` dispatch, `AddWidgetModal` third tab, `DashboardPage` WS subscription + fetches.
- [x] **8. i18n** — `en.json` first, then `fr.json`.
- [x] **9. UI tests** — `RecipeTile.test.tsx`.
- [x] **10. Docs** — `docs/technical/recipe-development.md` gains a "Dashboard tile" section: this is a new capability recipe authors must be able to discover. `docs/technical/data-model.md` was left alone — it never documented `dashboard_widgets` in the first place, and adding one table to a page that covers none of the others would be arbitrary.

## Test Plan

### Modules to test

- `src/api/routes/dashboard.ts` — creation of the new widget type, its two rejections, and the unchanged behaviour of the other two.
- `src/recipes/engine/recipe-manager.ts` — `tile` reaches `RecipeInfo`, and only when declared.
- `ui/src/components/dashboard/RecipeTile.tsx` — what renders and what is omitted.
- `migrations/029_dashboard_recipe_widget.sql` — the table recreate, on a database that already holds rows.

### Scenarios

| Module          | Scenario                                                                               | Expected                                                                      |
| --------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| dashboard route | `POST` `{type:"recipe", recipeInstanceId}` on an instance whose recipe declares a tile | 201, body carries `recipeInstanceId`, row persisted                           |
| dashboard route | `POST` `{type:"recipe"}` without `recipeInstanceId`                                    | 400 from the schema (`if`/`then`)                                             |
| dashboard route | `POST` with an unknown instance id                                                     | 400 `Recipe instance not found`                                               |
| dashboard route | `POST` on an instance whose recipe declares **no** tile                                | 400 `Recipe declares no tile`                                                 |
| dashboard route | `POST` `{type:"equipment"}` and `{type:"zone"}`                                        | unchanged: 201, and 400 on unknown ids                                        |
| dashboard route | `GET` after creating one widget of each type                                           | three widgets, each with its own id field populated and the others absent     |
| dashboard route | Deleting the recipe instance                                                           | the widget is gone from `GET` (FK cascade)                                    |
| dashboard route | non-admin `POST`                                                                       | 403, before any body validation                                               |
| recipe-manager  | `registerExternal` on a definition with `tile`                                         | `getRecipes()` entry carries it verbatim                                      |
| recipe-manager  | `registerExternal` on a definition without `tile`                                      | no `tile` key at all (not `undefined` in the payload)                         |
| RecipeTile      | state has summary + countdown + a declared action                                      | all three render; the countdown shows a remaining time                        |
| RecipeTile      | state has none of them                                                                 | icon + title only, no empty rows                                              |
| RecipeTile      | `tile.countdownKey` points at a past deadline                                          | no countdown                                                                  |
| RecipeTile      | `tile.actions` names an unknown action id                                              | that control is skipped, the others render                                    |
| RecipeTile      | instance disabled                                                                      | greyed, no control rendered                                                   |
| RecipeTile      | recipe missing from the store (uninstalled / no longer declares a tile)                | unavailable state, no crash                                                   |
| RecipeTile      | custom `widget.label` set                                                              | the label wins over the recipe name                                           |
| RecipeTile      | a control is clicked                                                                   | `sendAction(instanceId, actionId, { mode: <next> })`                          |
| RecipeTile      | five minutes pass on a live countdown                                                  | the remaining time drops, then the countdown disappears past the deadline     |
| migration 029   | rows of each pre-existing type, every optional column filled                           | copied across column for column                                               |
| migration 029   | applied inside a transaction with `foreign_keys = ON`                                  | succeeds — which is what makes the absent `PRAGMA foreign_keys = off` correct |
| migration 029   | `type: 'recipe'` after, `type: 'nope'` after                                           | accepted; rejected by the CHECK                                               |
| migration 029   | deleting the equipment / the zone / the instance                                       | each cascades its widget away                                                 |
| migration 029   | widget pointing at a non-existent instance                                             | rejected by the new foreign key                                               |

### Manual verification

- Pin a `delivery-gate` instance, watch the countdown tick and the pill cycle from the Dashboard, on desktop and on a phone-width viewport.
- Confirm an equipment widget and a zone widget still render identically after the migration on a real dashboard (the row-level guarantee is already pinned by the migration test).
