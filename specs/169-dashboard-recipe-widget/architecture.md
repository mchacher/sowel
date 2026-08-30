# Spec 169 — Architecture

## 1. Contract (`src/shared/types.ts`)

```ts
/** Opt-in Dashboard tile, declared by a recipe package (spec 169). */
export interface RecipeTileDef {
  /** Icon key from the tile icon set (closed list). Unknown or absent → default. */
  icon?: string;
  /** Instance-state key holding the one-line status. Default "summary". */
  summaryKey?: string;
  /** Instance-state key holding an ISO deadline to count down. Default "timerExpiresAt". */
  countdownKey?: string;
  /** Ids from this recipe's `actions` exposed as controls on the tile. */
  actions?: string[];
}

export interface RecipeDefinition {
  // ...
  tile?: RecipeTileDef; // absent = not pinnable
}

export interface RecipeInfo {
  // ...
  tile?: RecipeTileDef; // mirrored for the UI
}

export interface DashboardWidget {
  type: "equipment" | "zone" | "recipe";
  recipeInstanceId?: string;
  // ...
}
```

The contract is additive on every axis: an older package returns no `tile` and stays unpinnable; an older UI ignores a field it does not read.

## 2. Data model

`dashboard_widgets` is created in `001_initial.sql` with `CHECK(type IN ('equipment', 'zone'))`. **SQLite cannot alter a CHECK constraint**, so widening it is the table-recreate pattern, in one migration:

```sql
-- migrations/029_dashboard_recipe_widget.sql
CREATE TABLE dashboard_widgets_new (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('equipment', 'zone', 'recipe')),
  label TEXT,
  icon TEXT,
  equipment_id TEXT,
  zone_id TEXT,
  recipe_instance_id TEXT,
  family TEXT CHECK(family IN ('lights', 'shutters', 'heating', 'sensors')),
  display_order INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_id) REFERENCES equipments(id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE,
  FOREIGN KEY (recipe_instance_id) REFERENCES recipe_instances(id) ON DELETE CASCADE
);

INSERT INTO dashboard_widgets_new
  (id, type, label, icon, equipment_id, zone_id, family, display_order, config, created_at)
  SELECT id, type, label, icon, equipment_id, zone_id, family, display_order, config, created_at
  FROM dashboard_widgets;

DROP TABLE dashboard_widgets;
ALTER TABLE dashboard_widgets_new RENAME TO dashboard_widgets;
```

**No `PRAGMA foreign_keys = off` around it**, and that is deliberate. The runner
wraps every migration in a transaction (`core/database.ts`), and inside a
transaction that pragma is a silent no-op — writing it would look like
protection while providing none. It is not needed here for two checkable
reasons: nothing references `dashboard_widgets`, so the DROP breaks no inbound
key and the RENAME has no foreign clause to rewrite; and the outbound keys are
re-declared on the new table, which every copied row satisfied a moment earlier.
A table that _is_ referenced would need another approach.

The `family` CHECK is copied **verbatim**, including its four-value list that is narrower than `WidgetFamily`. Widening it is a real bug (`water`, `pool`, `displays`, `ventilation`, `power` are declared in TypeScript and rejected by the database) but it is not this spec's bug, and silently fixing it inside a recreate migration would hide it. Reported separately.

## 3. Event flow

Nothing new. The existing chain already carries what the tile needs:

```
recipe instance mutates ctx.state
  → RecipeStateStore persists
    → EventBus: "recipe.instance.state.changed" { instanceId, recipeId }
      → WebSocket "recipes" topic
        → useRecipes.fetchInstances() (coalesced)
          → RecipeTile re-renders
```

`DashboardPage` currently subscribes to `["equipments", "zones"]` and must add `"recipes"`.

## 4. API

`GET /api/v1/recipes` — unchanged shape, now carrying `tile` when the package declares one.

`POST /api/v1/dashboard/widgets` — `widgetCreateSchema` gains the third type:

```ts
type: { enum: ["equipment", "zone", "recipe"] },
recipeInstanceId: nonEmptyString,
// allOf:
{ if: { properties: { type: { const: "recipe" } }, required: ["type"] },
  then: { required: ["recipeInstanceId"] } },
```

The handler adds the two checks a schema cannot express, both `400` like their siblings:

- the instance exists (`SELECT id FROM recipe_instances WHERE id = ?`);
- its recipe declares a tile (`recipeManager.getRecipeById(recipeId)?.tile`) — which is why the route gains a `recipeManager` dependency.

`GET` and `PATCH` are untouched beyond `rowToWidget` carrying `recipeInstanceId`.

## 5. Files touched

### Server

| File                                         | Change                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                        | `RecipeTileDef`; `tile?` on `RecipeDefinition` and `RecipeInfo`; `"recipe"` + `recipeInstanceId?` on `DashboardWidget` |
| `migrations/029_dashboard_recipe_widget.sql` | New — table recreate (§2)                                                                                              |
| `src/recipes/engine/recipe-manager.ts`       | `registerExternal` copies `tile` into `RecipeInfo`, mirroring `actions`                                                |
| `src/api/routes/dashboard.ts`                | Third type in the schema; existence + eligibility checks; `recipe_instance_id` in INSERT and `rowToWidget`             |
| `src/api/server.ts`                          | Pass `recipeManager` into `registerDashboardRoutes`                                                                    |
| `src/api/routes/dashboard.test.ts`           | Cases from the test plan                                                                                               |

### UI

| File                                               | Change                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ui/src/types.ts`                                  | Mirror of the shared types                                                                       |
| `ui/src/components/recipes/recipe-form-fields.tsx` | `CountdownTimer` and `ModeCyclePill` exported for reuse (they already are — no behaviour change) |
| `ui/src/components/dashboard/RecipeTile.tsx`       | New — the tile, desktop and mobile                                                               |
| `ui/src/components/dashboard/WidgetGrid.tsx`       | Dispatch `widget.type === "recipe"` in `WidgetContent`                                           |
| `ui/src/components/dashboard/AddWidgetModal.tsx`   | Third tab, listing eligible instances only                                                       |
| `ui/src/pages/DashboardPage.tsx`                   | `useWsSubscription([..., "recipes"])`, fetch instances + recipes                                 |
| `ui/src/i18n/locales/{en,fr}.json`                 | Tab label, unavailable-tile wording                                                              |
| `ui/src/components/dashboard/RecipeTile.test.tsx`  | New — rendering cases                                                                            |

## 6. Rendering contract

`RecipeTile` receives `(widget, instance, recipe, isMobile, editMode)` and renders, top to bottom:

| Slot      | Source                                                         | Omitted when                     |
| --------- | -------------------------------------------------------------- | -------------------------------- |
| Icon      | `tile.icon` → tile icon set → `ChefHat`                        | never                            |
| Title     | `widget.label` → `recipeName(recipe, lang)`                    | never                            |
| Summary   | `instance.state[tile.summaryKey ?? "summary"]`                 | key absent or empty              |
| Countdown | `instance.state[tile.countdownKey ?? "timerExpiresAt"]`        | key absent, or deadline passed   |
| Controls  | `tile.actions` ∩ `recipe.actions`, rendered as `ModeCyclePill` | list empty, or instance disabled |

A widget whose recipe is missing or no longer declares `tile` renders the unavailable state: icon, title, and one localized line. No control, no crash.
