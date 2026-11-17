# Implementation Plan — Spec 211

**Status**: Draft 2026-11-17, revised after review — awaiting approval.

## Slices

### Slice A — Today's extremes on every thermometer (FR1)

- A.1 — `isTracked(eq, binding)` replaces the two `weather` gates of the tracker.
- A.2 — In-memory `lastSampleAt`; computed entries expose it as `lastUpdated`.
- A.3 — Header comment; spec 134 pointer.

### Slice B — History for recipes (FR2)

- B.1 — `history-query.ts`: export `parseFrom`; optional `onError`.
- B.2 — `recipe-history.ts`: validation, alignment, clamp, resolution, `isConnected`, rate limit,
  query, per-category normalisation, error mapping.
- B.3 — `RecipeHelpers.history?` in `recipe.ts`; `RecipeManager` optional `influxClient`,
  per-context `history`; `src/index.ts` passes the client.

### Slice C — Docs

- C.1 — `recipe-development.md` + `.fr.md` per the spec's Docs Delta.
- C.2 — specs-index rows (already in this PR).

## Test Plan

| Module           | Scenario                                                                | Expected                                                              |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| extremes tracker | `sensor`, `temperature` binding, samples 15 / 18                        | `_min_today` 15, `_max_today` 18                                      |
| extremes tracker | `sensor` with `temperature` and `temperature_2` bindings                | only `temperature` tracked                                            |
| extremes tracker | `sensor` with a `temperature_outdoor` binding                           | tracked under its alias                                               |
| extremes tracker | `thermostat` setpoint (category `temperature`, alias `setpoint`)        | ignored                                                               |
| extremes tracker | `thermostat` reading aliased `temperature`                              | tracked                                                               |
| extremes tracker | `sensor`, sample yesterday only                                         | no computed entries today                                             |
| extremes tracker | `sensor` with `humidity` only; `light_onoff` with a temperature binding | no entries / ignored unless the rule matches                          |
| extremes tracker | sample inside the envelope at 18:00 after a min at 06:30                | `lastUpdated` = 18:00, no SQLite write                                |
| extremes tracker | restart (rows reloaded)                                                 | envelope restored, `lastUpdated` = `updated_at` until the next sample |
| extremes tracker | `weather` station (spec 134 cases)                                      | unchanged                                                             |
| recipe-history   | energy 1h, raw-fallback rows stamped at the end + a partial last row    | points at hour starts, complete hours only                            |
| recipe-history   | rain 1h, rows stamped at the start; rain 1d                             | stamps unchanged, local days, running hour / day absent               |
| recipe-history   | temperature 1h, rows stamped at the end                                 | points at hour starts                                                 |
| recipe-history   | energy 1d with a partial running day                                    | UTC days stamped at their start, running day absent                   |
| recipe-history   | an hour without rows                                                    | no point for it (no zero)                                             |
| recipe-history   | alias that is a `computedData` entry with category `energy`             | queried as energy                                                     |
| recipe-history   | unknown alias / unknown equipment                                       | `{ points: [], ok: true }`, no Influx call                            |
| recipe-history   | boolean / enum binding; aggregation `"raw"` or `"5m"`                   | `{ points: [], ok: true }`, no Influx call                            |
| recipe-history   | `from` unparsable; `to` before the clamped `from`                       | `{ points: [], ok: true }`, no Influx call                            |
| recipe-history   | `from` = `-30d`                                                         | clamped to now − 7 d, one `warn` per instance                         |
| recipe-history   | Influx not configured                                                   | `{ points: [], ok: false }`, no query                                 |
| recipe-history   | `queryHistory` calls `onError` (partial rows)                           | `{ points: [], ok: false }`                                           |
| recipe-history   | programming error inside the wrapper                                    | `{ points: [], ok: false }`, `error` log                              |
| recipe-history   | 11 calls reaching Influx within 60 s                                    | 11th rejects `history rate limit`                                     |
| recipe-history   | 20 calls answered without Influx, then 10 real ones                     | all accepted                                                          |
| recipe-history   | 10 calls, 61 s later one more; two contexts with 10 calls each          | accepted                                                              |
| history-query    | `onError` absent (REST route)                                           | behaviour unchanged                                                   |
| recipe-manager   | without / with `influxClient`                                           | `ctx.helpers.history` undefined / a `query` function                  |
| recipe-manager   | `validate()` temporary context                                          | its own counter, an instance's budget untouched                       |
| history route    | existing route tests                                                    | unchanged                                                             |

The four per-category stamping cases pin today's `queryHistory` output on purpose: fixing the
pre-existing energy-bucket defect (spec FR2.9) must update them, never silently shift recipes'
buckets.

## Validation Plan

- `npm run validate`.
- Docs and spec checks: `bash scripts/check-specs-index.sh folders`,
  `bash scripts/check-specs-complete.sh`.
- Live, on Adrien's instance:
  1. An outdoor `sensor` shows `temperature_min_today` / `_max_today`, and their `lastUpdated`
     follows the probe's samples.
  2. The guest-home recipe gets 24 complete hourly points of `ConsommationGite.energy` and of the
     rain gauge, **each stamped at the start of its hour, the same hour for both**. Reference
     measured before the change on 2026-11-17 at 15:42 UTC through `/api/v1/history`: energy 1h
     at 12:00, 13:00, 14:00, 15:00 plus a partial point at 15:42:39 (end-stamped, raw fallback);
     energy 1d at 2026-11-15/16/17 00:00Z plus a partial point at the query instant; rain 1h
     stamped at the start of each hour, last full hour present, no running hour.
