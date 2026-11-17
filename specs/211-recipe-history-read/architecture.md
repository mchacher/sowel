# Spec 211 — Architecture

## R1 — extremes tracker

`src/equipments/weather-temp-extremes-tracker.ts` (spec 134) — the two `eq.type !== "weather"`
gates (`getComputedDataForEquipment`, `handleSample`) become `!TRACKED_TYPES.has(eq.type)` with
`TRACKED_TYPES = new Set(["weather", "sensor"])`. Table `weather_temp_extremes`, its rows and the
`_min_today` / `_max_today` aliases are unchanged (no migration; the table name stays, a comment
says it now covers sensors). The class keeps its name to keep the diff small; its header comment
names spec 211.

UI: none. The equipment detail already lists computed data; the `sensor` tile is not changed.

## R2 — `ctx.history`

### Types — `src/recipes/engine/recipe.ts` (and the mirrored external `RecipeContext` in
`src/shared/types.ts` / the recipe SDK typings, wherever `dispatchOrder` is declared for
external recipes)

```ts
export interface RecipeHistory {
  query(params: {
    equipmentId: string;
    alias: string;
    from: string;          // ISO-8601 or relative ("-24h"), as /api/v1/history
    to?: string;
    aggregation: "1h" | "1d";
  }): Promise<{ points: HistoryPoint[] }>;
}
// RecipeContext
history?: RecipeHistory;
```

### Implementation — `src/recipes/engine/recipe-history.ts` (new)

`createRecipeHistory({ influxClient, equipmentManager, logger, instanceId, now })`:

1. Rate limit: in-memory timestamps per instance, 10 per rolling minute.
2. Clamp `from` to `now - 7 d` (warn once per instance).
3. Equipment missing → `{ points: [] }`. Binding resolution identical to
   `src/api/routes/history.ts`: `getDataBindingsWithValues(id).find(alias)` → `dataType`,
   `category` (default `number`).
4. `influxClient.isConnected()` false → `{ points: [] }`.
5. `queryHistory(influxClient, { ..., aggregation }, logger)` → return `{ points }` only (drop
   `resolution`). Catch → `{ points: [] }` + debug log.

The route and the recipe share the binding resolution: extract
`resolveHistoryBinding(equipmentManager, equipmentId, alias)` into `src/history/` and call it from
both, so they cannot drift.

### Wiring

- `RecipeManager` constructor gains an optional `influxClient: InfluxClient | null = null` (last
  parameter, after `capacityArbiter`); `src/index.ts:479` passes the one built at line 375.
- `buildContext()` adds `history: this.influxClient ? createRecipeHistory({...}) : undefined`.
- Instance stop drops its rate-limit entry.

### Docs

- `docs/technical/recipe-development.md` and `.fr.md`, § **RecipeContext**: one row `history?`
  plus a short subsection "Reading history" with R2.9's time-stamp table and the "today's extremes
  come from `_min_today` / `_max_today`" rule.
- `docs/technical/api-reference.md`: nothing (no new route).
- Spec 134 folder: a line pointing to spec 211 for the widened scope.
- `docs/specs-index.md` / `.fr.md`: row 211.

## Event flow

Unchanged: the tracker still listens to `equipment.data.changed`; `ctx.history` is a pull API with
no event.
