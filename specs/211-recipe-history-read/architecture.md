# Architecture — Spec 211

## Flow diagram

```
equipment.data.changed ──► extremes tracker (FR1) ──► computedData <alias>_min_today/_max_today
                                                        (lastUpdated = last sample, in memory)

recipe ──► ctx.helpers.history.query (FR2)
             │ resolve binding / computedData ─ none, boolean/enum, bad window ─► { points: [], ok: true }
             │ isConnected() false ─────────────────────────────────────────────► { points: [], ok: false }
             │ rate limit (closure per context, calls reaching Influx only) ─────► reject "history rate limit"
             ▼
           align window (whole hours / the core's days, complete periods, ≥ now − 7 d)
             ▼
           queryHistory(...) ── error flag ─────────────────────────────────────► { points: [], ok: false }
             ▼
           normalise stamps per category to the start of the period ────────────► { points, ok: true }
```

## Components

### Changed: `src/equipments/weather-temp-extremes-tracker.ts` (FR1)

- The two `eq.type !== "weather"` gates (`getComputedDataForEquipment` `:125`, `handleSample`
  `:161`) become one predicate `isTracked(eq, binding)`: `weather` → the spec 134 categories as
  today; any other type → category `temperature` with alias `temperature`, or category
  `temperature_outdoor` — the rule of `zone-aggregator.ts:657`, `:785`.
- Each envelope gains an in-memory `lastSampleAt`, set on every integrated sample; the computed
  entries expose `lastUpdated = lastSampleAt ?? updatedAt`. The SQLite row and its `updated_at`
  are still written only when the envelope changes; on reload `lastSampleAt` starts empty, so
  `updated_at` is used until the next sample.
- Table `weather_temp_extremes`, its rows and aliases unchanged (no migration). The class keeps
  its name; its header comment names spec 211.

### Changed: `src/history/history-query.ts`

- `parseFrom` is exported (FR2.5).
- `queryHistory` gains an optional `onError?: () => void` in its params, called where it catches
  and logs today (`:585-590`), so the recipe wrapper knows a result may be partial (FR2.8). The
  REST route does not pass it: its behaviour is unchanged.

### New: `src/recipes/engine/recipe-history.ts`

`createRecipeHistory({ influxClient, equipmentManager, logger, instanceId, now })` returns the
`RecipeHistory` object, with its own rate-limit timestamps in the closure:

1. Validate `aggregation` (`1h` / `1d`) and the window with `parseFrom`; align it (FR2.5); clamp
   `from` to `now − 7 d`, one `warn` per closure.
2. Resolve: `getDataBindingsWithValues(id).find(alias)`, else the equipment's `computedData` entry
   with that alias → `dataType`, `category`. None, or `boolean` / `enum` → `{ points: [], ok: true }`.
3. `influxClient.isConnected()` false → `{ points: [], ok: false }`.
4. Rate limit (10 per rolling minute) — counted here, after the free exits.
5. `queryHistory(influxClient, { equipmentId, alias, from, to, aggregation, dataType, category, onError }, logger)`.
   Error flagged → `{ points: [], ok: false }`.
6. Normalise each point to the start of its period by category, per FR2.9 (energy and continuous
   measures: `time − period`; rain: unchanged); drop any point outside the aligned window.
7. Any throw except the rate limit → `{ points: [], ok: false }` + `error` log.

The route's own binding resolution (`src/api/routes/history.ts:220-224`) stays as it is: FR2.3
is deliberately stricter on the recipe path.

### Types

`src/recipes/engine/recipe.ts` only — external recipes see `RecipeCtx = any`
(`src/shared/types.ts:842`). `RecipeHelpers` (`types.ts:888-909`) gains:

```ts
history?: {
  query(params: {
    equipmentId: string;
    alias: string;
    from: string; // ISO-8601 or relative ("-24h"), as /api/v1/history
    to?: string;
    aggregation: "1h" | "1d";
  }): Promise<{ points: HistoryPoint[]; ok: boolean }>; // HistoryPoint from types.ts:555
};
```

### Wiring — `src/recipes/engine/recipe-manager.ts`

- Constructor gains an optional `influxClient: InfluxClient | null = null` (last parameter, after
  `capacityArbiter`); `src/index.ts:479` passes the one built at `:375`.
- `buildContext()` (`:716`) builds `helpers: { ...this.helpers, energy: …, history: … }` — a new
  `createRecipeHistory` per context, like `buildEnergyHelpers(instanceId)` at `:735`. Its counter
  therefore lives and dies with the context: nothing to clean on stop. The temporary contexts of
  `validate` (`:323`, `:406`) get their own counter and never drain an instance's budget.
  `history` is `undefined` when no `influxClient` was given.

## Files changed

| Domain  | File                                              | Change                                                  |
| ------- | ------------------------------------------------- | ------------------------------------------------------- |
| Core    | `src/equipments/weather-temp-extremes-tracker.ts` | Tracked bindings beyond `weather`; `lastSampleAt` (FR1) |
| Core    | `src/history/history-query.ts`                    | Export `parseFrom`; optional `onError`                  |
| Recipes | `src/recipes/engine/recipe-history.ts` (new)      | The wrapper (FR2)                                       |
| Recipes | `src/recipes/engine/recipe.ts`                    | `RecipeHelpers.history?`                                |
| Recipes | `src/recipes/engine/recipe-manager.ts`            | Optional `influxClient`; `history` per context          |
| Boot    | `src/index.ts`                                    | Passes the Influx client to `RecipeManager`             |
| Docs    | `docs/technical/recipe-development.md` + `.fr.md` | Spec Docs Delta                                         |
| Specs   | `specs/134-*/`, `docs/specs-index.md` + `.fr.md`  | Pointer to 211; row 211                                 |

## Event flow

Unchanged except FR1.5: the tracker still listens to `equipment.data.changed` and now emits
`<alias>_min_today` / `_max_today` changes for every tracked thermometer. `ctx.helpers.history`
is a pull API with no event.
