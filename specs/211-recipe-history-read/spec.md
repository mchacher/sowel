# Spec 211 — Today's extremes for every thermometer, and history for recipes

**Status**: Draft 2026-11-17, revised after review the same day.

## Context

`adn-dev-adrien/sowel-recipe-guest-home` relays part of the house to guestFlow, which shows it
to the guests of a holiday rental: room and outdoor temperatures with **today's min and max**, the
**24 last hourly** energy and rain figures. Its rule is that it computes nothing: every figure it
relays must already exist in Sowel.

Today two of those figures exist in Sowel but are out of a recipe's reach:

1. **Today's min/max.** Spec 134 tracks them from local midnight, as computed data
   `<alias>_min_today` / `<alias>_max_today`, but **only on `weather` equipments**. A room or
   outdoor thermometer is a `sensor` (on Adrien's instance, the outdoor probe in zone
   _Extérieur_ is a `sensor` too), so it has none.
2. **Hourly buckets.** `GET /api/v1/history/:equipmentId/:alias?aggregation=1h` returns them, but
   a recipe only receives `RecipeContext`, which has no history access. The recipe used to sample
   the live value every hour and store its own buckets — a second, worse copy of what Influx
   already holds, which this spec removes the need for.

## Goals

1. Every thermometer gets today's extremes, with the spec 134 contract.
2. A recipe reads hourly and daily buckets of the history Sowel already keeps, read-only,
   bounded, with one time-stamp convention whatever the category.

## Non-Goals

- Local-day `1d` buckets for continuous measures (would change the downsampling task and every
  chart reading it).
- Fixing the pre-existing energy-bucket defect described in FR2.9 — a separate issue.
- Min/max on dashboard tiles of `sensor` equipments.
- History for plugins (`PluginDeps`).
- A raw-sample read for recipes.

## Functional Requirements

### FR1 — Today's extremes on every thermometer (amends spec 134)

1. **Which bindings.** `weather` equipments are unchanged (every binding of a spec 134 tracked
   category). On **any other equipment type**, the tracker follows the bindings the core already
   treats as a room temperature — category `temperature` **with alias `temperature`** (the rule of
   `zone-aggregator.ts:657`, `:785`, which itself leaves outdoor temperature aside) — plus any
   binding of category `temperature_outdoor`, the second category spec 134 tracks. A
   thermostat's or heater's setpoint (category `temperature`, another alias) is therefore never
   tracked; a room measured only by a `thermostat` whose reading is aliased `temperature` gets its
   extremes like a `sensor`.
2. **Same contract as spec 134** for those equipments: computed data `<alias>_min_today` and
   `<alias>_max_today`, unit `°C`, envelope reset at **local midnight** (spec 061), persisted
   across restarts, hidden before the first sample of the day.
3. **`lastUpdated` of the two entries is the instant of the last sample integrated into the
   envelope**, not the last time the envelope widened. Today `lastUpdated = env.updatedAt`
   (`weather-temp-extremes-tracker.ts:139`, `:146`), which only moves when a new min or max is
   reached (`:183-191`): a minimum reached at 06:30 still dated 06:30 at 18:00 reads as a stale
   value to any consumer judging freshness. The new instant is kept **in memory** (no SQLite
   write per sample — the row is still written only when the envelope changes); after a restart
   it starts from the row's `updated_at` until the next sample. The weather UI is unaffected
   (`WeatherPanel.tsx:209-210` reads `.value` only).
4. The dashboard is unchanged: a `sensor` tile does not start showing min/max (the values are
   available in the equipment detail's computed data and to recipes only).
5. **Events.** The tracker emits `equipment.data.changed` for `<alias>_min_today` /
   `_max_today` (`weather-temp-extremes-tracker.ts:207-218`) — for `sensor` equipments too from
   now on. A recipe reacting to every change of a sensor without filtering the alias will see
   them; the recipe-development doc says so.

### FR2 — `ctx.helpers.history` for recipes

1. **Placement.** `RecipeHelpers` gains an **optional** member `history`, following the read-only
   capabilities of specs 126, 138 and 140 (`ctx.helpers.getSunlight`, `getTariff`, `energy`). A
   recipe tests `ctx.helpers.history` before using it: absent on an older core.
2. **Call.** `ctx.helpers.history.query({ equipmentId, alias, from, to?, aggregation })` returns
   `Promise<{ points: { time: string; value: number; min?: number; max?: number }[]; ok: boolean }>`.
   `aggregation` is `"1h"` or `"1d"` only.
3. **Resolution, before any Influx call.** The alias is looked up as a data binding of the
   equipment, else as one of its computed data entries (`computedData`, which carries the
   category — e.g. the `energy` key a power-only sub-meter integrates and writes to Influx,
   `power-submeter-integrator.ts:315-324`, `:364-380`). Neither → `{ points: [], ok: true }`
   without querying. This also means the alias interpolated into Flux
   (`history-query.ts:153`, `:175`, `:186`, `:197`) is always one the core itself declared. The
   REST route keeps its own behaviour (it queries even without a binding, as `number`); only the
   recipe path resolves strictly.
4. **Types refused before Influx.** A `boolean` or `enum` binding (which `queryHistory` forces to
   `raw`, with up to 2000 points and a carry-in query, `history-query.ts:379-383`, `:419-449`), an
   `aggregation` other than `"1h"` / `"1d"` (external recipes are plain JS, `RecipeCtx = any`) →
   `{ points: [], ok: true }`.
5. **Window.** The wrapper parses both `from` and `to` with `parseFrom`, which `history-query.ts`
   exports for this: ISO-8601 or a relative form (`-30m`, `-24h`, `-7d`). A relative `to` is
   therefore specific to the recipe path — the REST route reads `to` with `new Date(params.to)`
   (`history-query.ts:375`). `to` defaults to now. Then, in this order:
   1. `to = min(to, now)` — a future `to` never brings in the running period;
   2. `from = max(from, now − 7 days)` — clamped, logged once per instance at `warn`;
   3. `from` is rounded **up** to the next period boundary and `to` **down** to the start of its
      period, the boundaries being whole hours (`1h`) or the midnights of the day as the core cuts
      it for that category (`1d`: local for rain, UTC for energy and continuous measures, FR2.9);
   4. `queryHistory` is called with `to = alignedTo + 1 period` — Flux's `range` stop is
      exclusive, and a store stamping its periods at their end (the hourly bucket stores the hour
      14:00–15:00 at 15:00) would otherwise lose the last complete period;
   5. after FR2.6's normalisation, only the points with `alignedFrom ≤ t < alignedTo` are kept:
      the running period, which the extra period brings in, is stamped `alignedTo` and dropped.

   So the result holds **complete periods only**, never the running hour or day, and the first
   period is never cut by the 7-day clamp. A recipe that needs local days for energy reads `1h` and
   keeps the hours it wants. An unparsable `from` / `to`, or an aligned `to` not after the aligned
   `from` → `{ points: [], ok: true }` without querying.

6. **Time stamps — one convention.** Every point is stamped at the **start of its period**, in UTC
   ISO-8601. Since the stamping depends on **which bucket answered**, not only on the category,
   `queryHistory` also returns `source: "downsampled" | "raw"`, and the wrapper normalises on the
   couple (category, source):

   | Category   | Source        | Stored stamp (today, FR2.9) | Normalisation  |
   | ---------- | ------------- | --------------------------- | -------------- |
   | energy     | `downsampled` | start (`timeSrc: "_start"`) | none           |
   | energy     | `raw`         | end                         | `− one period` |
   | continuous | either        | end                         | `− one period` |
   | rain       | either        | start (`timeShift(-1h)`)    | none           |

   The energy `downsampled` row is unused today (FR2.9's pre-existing defect) and correct the day
   that defect is fixed. **Exception — `1d` of continuous measures:** the daily task's day runs
   23:00 → 23:00 UTC (FR2.9); the normalised point is labelled by its UTC date, approximately (it
   covers the hour before that midnight and not the last hour of the date). This spec does not
   promise a start-of-day stamp for it; a recipe wanting today's extremes reads FR1, not `1d`
   history. Points are **sparse**: a period without samples has no point; nothing is zero-filled.

7. **Bounds.** At most **10 calls per rolling minute per instance**, counting only the calls that
   reach Influx (calls answered by FR2.3-FR2.5 are free). Beyond: the promise rejects with
   `Error("history rate limit")`. One call may run up to 3 Flux queries inside `queryHistory`
   (downsampled bucket, fallback, union); the limit counts calls, which is what a recipe controls.
   Results keep core's existing `limit(n: 500)` for aggregated queries.
8. **Errors.** `ok` tells an empty answer from an outage:
   - Influx not configured (`isConnected()` false — it means configured, not reachable,
     `influx-client.ts:80-103`, `:152-154`) → `{ points: [], ok: false }`, no query;
   - Influx configured but unreachable or failing: `queryHistory` catches the error itself, logs it
     at `error` and may return **partial** points (`history-query.ts:585-590`). The wrapper cannot
     see that from the result alone, so `queryHistory` reports whether it hit an error, and the
     wrapper returns `{ points: [], ok: false }` in that case (partial points are dropped);
   - any other throw (a programming error) → `{ points: [], ok: false }` and an `error` log;
   - never a throw into the recipe, except the rate limit (FR2.7).
9. **What the core stamps today, measured** (code read in `history-query.ts` and
   `influx-client.ts`; measured on Adrien's instance on 2026-11-17 at 15:42 UTC). This is what
   FR2.6 normalises:
   - **energy, 1h:** the downsampled `sowel-energy-hourly` bucket stores `value_number`
     (`influx-client.ts:808-829`) but `buildFluxQuery` filters `_field == "mean"` on it
     (`history-query.ts:182-189`), so it reads nothing and falls back to the raw bucket
     (`:499-523`, `:216-223`): `aggregateWindow(every: 1h, fn: sum)` stamped at the **end** of the
     hour, UTC, raw retention (7 days), the last bucket partial and stamped at the query instant.
     Measured: points at 12:00, 13:00, 14:00, 15:00 and a partial one at 15:42:39.
   - **energy, 1d:** same fallback — UTC days stamped at the end, the running day partial.
     Measured: 2026-11-15, -16, -17 at 00:00Z plus a partial point at the query instant.
   - **rain:** sums stamped at the **start** of the period, days cut at local midnight
     (`history-query.ts:147-180`). Measured: hourly points at the start of each hour, the last full
     hour present, no point for the running hour.
   - **continuous measures (temperature…), 1h:** mean/min/max stamped at the **end** of the hour
     (`influx-client.ts:756-776`).
   - **continuous measures, 1d:** the `sowel-downsample-daily` task aggregates hourly points
     stamped at the end of their hour, so its "UTC day" runs 23:00 → 23:00 UTC
     (`influx-client.ts:780-804`), stamped at the end, finished days only — except that when the
     daily bucket is empty the raw fallback (`history-query.ts:553-583`) returns the running day,
     partial. Today's extremes therefore come from FR1, never from `1d` history.

   The energy `value_number` / `mean` mismatch is a **pre-existing defect** (it also affects the
   UI charts, which read the raw fallback): out of scope here, to be filed as its own issue. FR2.6
   already normalises on the bucket that answered, so fixing it does not shift recipes' buckets;
   and a test in `history-query.test.ts`, citing 211 FR2.6, pins today's `_field == "mean"` filter
   on the energy downsampled buckets, so whoever fixes the defect is sent to FR2.6's table.

10. **Security.** No new exposure: a recipe already holds the whole `equipmentManager` (every
    equipment's live values); history reads the same equipments' past values, read-only.

## Consumer

`sowel-recipe-guest-home` reads `temperature_min_today` / `temperature_max_today` live (FR1) and
`ctx.helpers.history.query({ aggregation: "1h", from: "-24h" })` for the hourly energy and rain
bars (FR2), and drops its own hourly sampling. Its budget is **one call per hourly pair per closed
hour** — two pairs on Adrien's instance (gîte energy, rain), far under FR2.7.

## Acceptance Criteria

- [ ] A `sensor` with a `temperature` binding exposes `temperature_min_today` / `_max_today` after
      its first sample of the day; after local midnight they disappear until the next sample.
- [ ] Their `lastUpdated` follows every sample, even when the envelope does not move.
- [ ] A thermostat setpoint is never tracked; a `weather` station behaves exactly as under spec 134.
- [ ] `ctx.helpers.history.query({ aggregation: "1h", from: "-24h" })` on an energy equipment and
      on a rain gauge returns complete hours only, each stamped at the start of its hour, the same
      hours for both — the last complete hour included.
- [ ] Unknown alias, boolean binding, invalid aggregation or window → `{ points: [], ok: true }`
      with no Influx call.
- [ ] Influx not configured, unreachable or failing → `{ points: [], ok: false }`.
- [ ] The 11th call reaching Influx in a minute from one instance rejects; another instance, and
      calls answered without Influx, are unaffected.

## Edge Cases

- A `sensor` with two temperature bindings (`temperature` and `temperature_2`): only `temperature`
  is tracked (FR1.1); a `temperature_outdoor` binding is tracked under its own alias.
- Restart mid-day: envelope restored from SQLite, `lastUpdated` = the row's `updated_at` until the
  next sample.
- DST change: the extremes reset at spec 061's local midnight (23- or 25-hour days); `1d` history
  of rain keeps whole local days, energy and continuous measures UTC days (FR2.5).
- An hour without samples: no point for it (FR2.6).
- A window clamped to 7 days: one `warn` per instance, not per call; `from` is then rounded up to
  the next period boundary, so the first period is complete (and, for energy `1d`, inside the raw
  bucket's 7-day retention).
- A `to` in the future: brought back to now before alignment (FR2.5).
- `validate()` runs on a temporary context (`recipe-manager.ts:323`, `:406`); it gets its own
  counter and is not expected to query.
- "A `1d` query never returns today" holds for the recipe path only because FR2.5 cuts the window
  at the start of the running day; the REST route can still return a partial running day (FR2.9).

## Docs Delta

| Page (EN and FR)                                                                                      | Change                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/technical/recipe-development.md` + `.fr.md`, `ctx.helpers`                                      | Row `history?` and a subsection "Reading history": the call, `ok`, the start-of-period stamping, complete periods only, sparse points, the limit and its budget, "on a rate rejection keep what was already read and resume at the next tick", FR1.5 events |
| `docs/technical/recipe-development.md` + `.fr.md`, a new subsection under `## RecipeContext` (`:349`) | `_min_today` / `_max_today` now on every thermometer (FR1.1), and their `lastUpdated` (FR1.3)                                                                                                                                                               |
| `specs/134-*/`                                                                                        | A line pointing to spec 211 for the widened scope                                                                                                                                                                                                           |

Screenshots to retake: none.
