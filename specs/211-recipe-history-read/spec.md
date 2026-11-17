# Spec 211 — Today's extremes for every thermometer, and history for recipes

**Status**: Draft 2026-11-17.

## Problem

`adn-dev-adrien/sowel-recipe-guest-home` relays part of the house to guestFlow, which shows it
to the guests of a holiday rental: room and outdoor temperatures with **today's min and max**, the
**24 last hourly** energy and rain figures. Its rule is that it computes nothing: every figure it
relays must already exist in Sowel.

Today two of those figures exist in Sowel but are out of a recipe's reach:

1. **Today's min/max.** Spec 134 tracks them from local midnight, as computed data
   `<alias>_min_today` / `<alias>_max_today`, but **only on `weather` equipments**. A room or
   outdoor thermometer is a `sensor` (on Adrien's instance, the outdoor probe in zone
   *Extérieur* is a `sensor` too), so it has none.
2. **Hourly buckets.** `GET /api/v1/history/:equipmentId/:alias?aggregation=1h` returns them, but
   a recipe only receives `RecipeContext`, which has no history access. The recipe works around
   it today by sampling the live value every hour and storing its own buckets — a second, worse
   copy of what Influx already holds, which this spec removes the need for.

## Scope

### R1 — Today's extremes on every thermometer (amends spec 134)

1. The spec 134 tracker follows every **temperature binding** (`temperature`,
   `temperature_outdoor` categories), on any equipment type that is not an actuator whose
   temperature is a setpoint — concretely: `weather` (unchanged) and `sensor`.
2. Same contract as spec 134 for those equipments: computed data `<alias>_min_today` and
   `<alias>_max_today`, unit `°C`, envelope reset at **local midnight** (spec 061), persisted
   across restarts, hidden before the first sample of the day.
3. The dashboard is unchanged: a `sensor` tile does not start showing min/max (the values are
   available in the equipment detail's computed data and to recipes only). Showing them on tiles
   is out of scope.

### R2 — `ctx.history` for recipes

4. `RecipeContext` gains an **optional** member `history` (older recipes, and older cores for new
   recipes, keep working: a recipe tests for it).
5. `ctx.history.query({ equipmentId, alias, from, to?, aggregation })` returns
   `Promise<{ points: { time: string; value: number; min?: number; max?: number }[] }>` — exactly
   what `GET /api/v1/history/:equipmentId/:alias` returns for the same arguments, through the same
   `queryHistory`, with `dataType` / `category` resolved from the binding the same way the route
   does. Nothing new is computed in core.
6. `aggregation` is `"1h"` or `"1d"` only (no `raw`, no `auto`): a recipe asks for buckets, not
   samples.
7. **Bounds**, so a recipe cannot hammer Influx: the window is at most **7 days** (`from` older
   than that is clamped, logged once per instance at `warn`); at most **10 queries per minute per
   instance** (beyond: rejected with an `Error("history rate limit")`); results keep core's existing
   `limit(n: 500)`.
8. Unknown equipment or alias → `{ points: [] }`. Influx not configured or not connected →
   `{ points: [] }`. Query failure → `{ points: [] }` and a `debug` log; never a throw into the
   recipe (except the rate limit, R2.7).
9. **Time stamps and day boundaries are those of `/api/v1/history` today, and this spec documents
   them rather than changing them** (verified in `history-query.ts` and `influx-client.ts`, and
   against Adrien's instance on 2026-11-17):
   - `energy`: hourly and daily buckets are sums stamped at the **start** of the period; days cut
     at **local** midnight (`location: timezone.location(...)`).
   - `rain`: same — sums, stamped at the start, local days (spec 119).
   - continuous measures (temperature…): `1h` buckets carry mean/min/max stamped at the **end** of
     the hour; `1d` buckets come from the `sowel-downsample-daily` task, which aggregates on **UTC
     days** stamped at the **end** (UTC midnight), and only for **finished** days. So a `1d` query
     never returns *today*, and its day is the UTC one. **Today's extremes come from R1, not from
     `1d` history.** This is written in the recipe-development doc.
10. Security: no new exposure. A recipe already holds the whole `equipmentManager` (every
    equipment's live values); history reads the same equipments' past values, read-only.

## Consumer

`sowel-recipe-guest-home` will read `temperature_min_today` / `temperature_max_today` live (R1) and
`ctx.history.query({ aggregation: "1h", from: <24 h ago> })` for the hourly energy and rain bars
(R2), and drop its own hourly sampling. Live `energy_hour` / `energy_day` computed data already
exist and are unaffected.

## Acceptance criteria

- A `sensor` with a `temperature` binding exposes `temperature_min_today` / `_max_today` after its
  first sample of the day; after local midnight they disappear until the next sample.
- A `weather` station behaves exactly as under spec 134.
- A recipe calling `ctx.history.query({ ..., aggregation: "1h", from: <-24h> })` on an energy
  equipment gets the same points as the REST route.
- The 11th query in a minute from one instance rejects; another instance is unaffected.
- With Influx disconnected, `query` resolves to `{ points: [] }`.

## Out of scope

- Local-day `1d` buckets for continuous measures (would change the downsampling task and every
  chart reading it).
- Min/max on dashboard tiles of `sensor` equipments.
- History for plugins (`PluginDeps`).
- A raw-sample read for recipes.
