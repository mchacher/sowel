# Spec 119 — Energy history API: per-period aggregation

## Problem

`GET /api/v1/energy/history` and `GET /api/v1/energy/by-usage` accept a
`period` parameter (`day` / `week` / `month` / `year`) and return a
`points: EnergyPoint[]` array. Today the resolution of those points is
mismatched with the user-facing chart granularity:

| Period | Returned today | Chart actually wants | Wasted on the wire |
| ------ | -------------- | -------------------- | ------------------ |
| day    | 24 hourly      | 24 hourly            | 0 (already right)  |
| week   | **168 hourly** | 7 daily              | 24× the points     |
| month  | ~30 daily      | ~30 daily            | 0                  |
| year   | **~365 daily** | 12 monthly           | ~30× the points    |

Every chart consumer (`EnergyBarChart.tsx` in the web UI, and the new
firmware iter 034 period switch on `sowel-energy-display`) re-aggregates
the raw points client-side to produce the per-period bars. The work is
duplicated across consumers, inflates the response payload by 24×-30×
on the larger windows, and forces the firmware to ship date-math code
just to bucket points by local day / month.

This spec moves the aggregation server-side once and for all.

## Goals

- Return a **fixed number of buckets per period**, pre-aggregated to
  the granularity the chart actually plots:
  - `day` → 24 hourly buckets
  - `week` → 7 daily buckets (Mon–Sun, local TZ)
  - `month` → 28..31 daily buckets (1st → last of the month, local TZ)
  - `year` → 12 monthly buckets (Jan → Dec, local TZ)
- Preserve the existing response shape (`EnergyHistoryResponse` /
  `EnergyByUsageResponse`). Only the **count** and **`time` granularity**
  of `points[]` change; the per-point field schema stays identical.
- Preserve the **HP / HC tariff split** on every period. Influx's
  `aggregateWindow(every: 1d|1mo, fn: sum, location: …)` produces
  per-bucket sums that keep the HP and HC series independent — no
  client-side tariff classification involved.
- Bucket boundaries align to **local midnight** of the server's
  configured timezone (`Europe/Paris` by default per `docker-compose.yml`
  TZ env), not UTC. A week starts at Monday 00:00 local, a month at
  the 1st local 00:00, a year at January 1st local 00:00.
- Empty buckets (hours / days / months with no data) are **returned with
  zeros** rather than skipped, so consumers can iterate `0..N-1`
  without gap-handling code.

## Non-goals

- Reshape the **per-point** schema (`{ time, hp, hc, prod, autoconso,
injection }`). Existing fields stay, no new ones.
- New endpoints. Same routes, same query parameters, same auth.
- Cleanup of the four client-side aggregation functions in
  `EnergyBarChart.tsx` (`aggregateDay/Week/Month/Year`). They keep
  working unchanged — summing N=1 per bucket trivially equals the
  bucket itself. Their removal is a follow-up tidy-up.
- Sensor history (`/api/v1/history`) — different pipeline (analyse
  page, spec 118), out of scope.
- Per-user / per-zone TZ override. We use the server's TZ; multi-zone
  TZ support is a separate consideration.

## API contract

Both endpoints keep the same signature:

```
GET /api/v1/energy/history?period=<P>&date=<YYYY-MM-DD>
GET /api/v1/energy/by-usage?period=<P>&date=<YYYY-MM-DD>
```

`period` ∈ `{ day, week, month, year }` (unchanged).

### Response shape

`EnergyHistoryResponse` field by field:

| Field        | Type                              | Change for spec 119       |
| ------------ | --------------------------------- | ------------------------- |
| `period`     | `string`                          | unchanged                 |
| `from`       | `string` (ISO)                    | now local-TZ aligned      |
| `to`         | `string` (ISO)                    | now local-TZ aligned      |
| `resolution` | `"5min" \| "1h" \| "1d" \| "1mo"` | **new literal `"1mo"`**   |
| `points`     | `EnergyPoint[]`                   | **fixed N + zero-filled** |
| `totals`     | `EnergyTotals`                    | unchanged (sum of points) |

`EnergyByUsageResponse.submeters[i].points[]` follows the same
N-buckets-per-period rule.

### Bucket count per period

| Period | N                                    | Bucket span     | Edge cases                                         |
| ------ | ------------------------------------ | --------------- | -------------------------------------------------- |
| day    | 24                                   | 1 hour          | "today before X o'clock" — future hours = 0        |
| week   | 7                                    | 1 day (local)   | week with DST switch — bucket sum spans 23h or 25h |
| month  | 28 / 29 / 30 / 31 depending on month | 1 day (local)   | February in leap vs non-leap year                  |
| year   | 12                                   | 1 month (local) | partial current year — future months = 0           |

### Resolution literal extension

`EnergyHistoryResponse.resolution` was `"5min" | "1h" | "1d"`. This
spec adds `"1mo"` for the yearly bucket. Consumers reading
`resolution` to label axes (none today, but the firmware iter 034 may)
get the right hint.

## Acceptance criteria

- [x] `GET /api/v1/energy/history?period=day&date=YYYY-MM-DD` returns
      `points.length == 24` (was: variable, between 0 and 24). Today
      with no data yet returns 24 zero points.
- [x] `?period=week` returns `points.length == 7`, each `time` aligned
      to local 00:00 of the day, Monday through Sunday of the week
      containing `date`.
- [x] `?period=month` returns `points.length == days_in_month(date)`,
      each `time` aligned to local 00:00 of the day.
- [x] `?period=year` returns `points.length == 12`, each `time`
      aligned to local 00:00 of the 1st of the month, January through
      December of the year containing `date`.
- [x] `response.resolution` reads `"1h"`, `"1d"`, `"1d"`, `"1mo"` for
      day / week / month / year respectively.
- [x] HP / HC are preserved on every bucket — a `?period=week` query
      against a household with HP/HC tariff returns `hp` and `hc` as
      independent sums per day, not collapsed.
- [x] `?period=year` against a fresh install (no historical data)
      returns 12 zero buckets without throwing.
- [x] Same coverage for `/api/v1/energy/by-usage`: per-submeter
      `points[]` has the right N for every period.
- [x] `npx tsc --noEmit` clean, `npx vitest run` 780 / 780, new
      `src/api/routes/energy.test.ts` (11 cases) covers the
      per-period bucket count + TZ-aligned boundaries + HP/HC
      preservation.
- [x] No regression on existing consumers: the web UI energy page
      renders the same chart it did before (the in-UI
      `aggregateWeek/Month/Year` functions trivially pass through
      the now-pre-aggregated points).

## Edge cases & decisions

- **DST switch in week mode**: when the bucket spans a Sunday with a
  DST transition, the day is 23h or 25h. Flux's `aggregateWindow`
  with `location` handles the boundary natively — the bucket sum
  covers the local 24h, regardless of the actual UTC span.
- **Leap year in month mode**: February returns 29 daily buckets in
  a leap year. `computeRange` for month already iterates
  `getDate() + 1` until next-month-1st, so the count is naturally
  correct.
- **Empty buckets**: `aggregateWindow(... createEmpty: true)`
  produces a zero-valued row for buckets with no Influx data. The
  current queries set `createEmpty: false` (skip empties); spec 119
  flips it to `true` for the per-period endpoints so the response
  always has the expected N.
- **Future date in `?date=`**: the planner clamps `to` to
  `min(period_end, now)`. For `?period=year&date=2027-06-15`, only
  Jan-Jun get real data, Jul-Dec return zero buckets. No 4xx.
- **Date before install**: same as above — zero buckets, no error.
- **Server TZ resolution**: use `process.env.TZ` (set to
  `Europe/Paris` in `docker-compose.yml`), fall back to
  `"Europe/Paris"` if unset. Logged at startup so an operator can
  catch a misconfig.
