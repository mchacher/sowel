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
           to ≤ now; from ≥ now − 7 d; from rounded up, to down (whole hours / the core's days)
             ▼
           queryHistory(to + 1 period) ── error flag ──────────────────────────► { points: [], ok: false }
             ▼
           normalise on (category, source); keep from ≤ t < to ────────────────► { points, ok: true }
```

## Components

### Changed: `src/equipments/weather-temp-extremes-tracker.ts` (FR1)

- The two `eq.type !== "weather"` gates (`getComputedDataForEquipment` `:125`, `handleSample`
  `:161`) become one predicate `isTracked(eq, binding)`: `weather` → the spec 134 categories as
  today; any other type → category `temperature` with alias `temperature` (the rule of
  `zone-aggregator.ts:657`, `:785`), or category `temperature_outdoor` (the second category spec 134
  tracks; the zone aggregator leaves it aside).
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
- `HistoryQueryResult` gains `source: "downsampled" | "raw"` — which bucket answered (FR2.6). The
  REST route ignores it; its payload is unchanged.

### New: `src/recipes/engine/recipe-history.ts`

`createRecipeHistory({ influxClient, equipmentManager, logger, instanceId, now })` returns the
`RecipeHistory` object, with its own rate-limit timestamps in the closure:

1. Validate `aggregation` (`1h` / `1d`); parse `from` and `to` with `parseFrom`; `to = min(to, now)`;
   clamp `from` to `now − 7 d` (one `warn` per closure); round `from` up and `to` down to the
   period boundaries of FR2.5.
2. Resolve: `getDataBindingsWithValues(id).find(alias)` → its `dataType`, `category`; else
   `equipmentManager.getByIdWithDetails(id).computedData` (the public path —
   `getComputedData` is private, `equipment-manager.ts:229`) → `dataType = "number"` (a
   `ComputedDataEntry` has none, `types.ts:627-633`), `category` read from the entry. None, or a
   `boolean` / `enum` binding → `{ points: [], ok: true }`.
3. `influxClient.isConnected()` false → `{ points: [], ok: false }`.
4. Rate limit (10 per rolling minute) — counted here, after the free exits.
5. `queryHistory(influxClient, { equipmentId, alias, from: alignedFrom, to: alignedTo + 1 period, aggregation, dataType, category, onError }, logger)`
   → `{ points, source }`. Error flagged → `{ points: [], ok: false }`.
6. Normalise each point on (category, `source`) per FR2.6's table; keep only
   `alignedFrom ≤ t < alignedTo` — which drops the running period the extra period brought in.
7. Any throw except the rate limit → `{ points: [], ok: false }` + `error` log.

The route's own binding resolution (`src/api/routes/history.ts:220-224`) stays as it is: FR2.3
is deliberately stricter on the recipe path.

### Types

`src/shared/types.ts`, where `RecipeHelpers` is defined (`:888-909`; `recipe.ts` only imports
it) — external recipes see `RecipeCtx = any` (`:842`). `RecipeHelpers` gains:

```ts
history?: {
  query(params: {
    equipmentId: string;
    alias: string;
    from: string; // ISO-8601 or relative ("-24h"), parsed by parseFrom
    to?: string; // same forms — relative `to` exists on the recipe path only
    aggregation: "1h" | "1d";
  }): Promise<{ points: HistoryPoint[]; ok: boolean }>; // HistoryPoint from types.ts:555
};
```

### Wiring — `src/recipes/engine/recipe-manager.ts`

- Constructor gains an optional `influxClient: InfluxClient | null = null` (last parameter, after
  `capacityArbiter`); `src/index.ts:479` passes the one built at `:375`.
- The manager's shared helpers are typed `Omit<RecipeHelpers, "energy">` at `:620`; it becomes
  `Omit<RecipeHelpers, "energy" | "history">`, both being built per context.
- `buildContext()` (`:716`) builds `helpers: { ...this.helpers, energy: …, history: … }` — a new
  `createRecipeHistory` per context, like `buildEnergyHelpers(instanceId)` at `:735`. Its counter
  therefore lives and dies with the context: nothing to clean on stop. The temporary contexts of
  `validate` (`:323`, `:406`) get their own counter and never drain an instance's budget.
  `history` is `undefined` when no `influxClient` was given.

## Files changed

| Domain  | File                                              | Change                                                  |
| ------- | ------------------------------------------------- | ------------------------------------------------------- |
| Core    | `src/equipments/weather-temp-extremes-tracker.ts` | Tracked bindings beyond `weather`; `lastSampleAt` (FR1) |
| Core    | `src/history/history-query.ts`                    | Export `parseFrom`; optional `onError`; `source`        |
| Recipes | `src/recipes/engine/recipe-history.ts` (new)      | The wrapper (FR2)                                       |
| Shared  | `src/shared/types.ts`                             | `RecipeHelpers.history?`                                |
| Recipes | `src/recipes/engine/recipe-manager.ts`            | Optional `influxClient`; `history` per context; `Omit`  |
| Boot    | `src/index.ts`                                    | Passes the Influx client to `RecipeManager`             |
| Docs    | `docs/technical/recipe-development.md` + `.fr.md` | Spec Docs Delta                                         |
| Specs   | `specs/134-*/`, `docs/specs-index.md` + `.fr.md`  | Pointer to 211; row 211                                 |

## Event flow

Unchanged except FR1.5: the tracker still listens to `equipment.data.changed` and now emits
`<alias>_min_today` / `_max_today` changes for every tracked thermometer. `ctx.helpers.history`
is a pull API with no event.
