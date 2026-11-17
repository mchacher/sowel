# Spec 211 — Plan

**Status**: Draft 2026-11-17 — awaiting approval.

## Steps

1. [ ] R1: widen the tracker gates to `sensor`; header comment; spec 134 pointer.
2. [ ] Extract `resolveHistoryBinding` from `src/api/routes/history.ts` into `src/history/`.
3. [ ] `RecipeHistory` type on `RecipeContext` (internal + external typings).
4. [ ] `src/recipes/engine/recipe-history.ts`: clamp, rate limit, empty results, error swallow.
5. [ ] `RecipeManager`: optional `influxClient`, `buildContext()` wiring, cleanup on stop;
       `src/index.ts` passes the client.
6. [ ] Docs EN/FR (recipe-development), specs-index rows.
7. [ ] Live check on Adrien's instance: an outdoor `sensor` shows `temperature_min_today`; the
       guest-home recipe gets 24 hourly points of `ConsommationGite.energy`.

## Test Plan

| Module                | Scenario                                                 | Expected                                                    |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| extremes tracker      | `sensor` with `temperature` binding, two samples 15 / 18 | `_min_today` 15, `_max_today` 18                            |
| extremes tracker      | `sensor`, sample yesterday only                          | no computed entries today                                   |
| extremes tracker      | `sensor` with `humidity` binding only                    | no entries                                                  |
| extremes tracker      | `weather` station (retro-compat, spec 134 cases)         | unchanged                                                   |
| extremes tracker      | `light_onoff` with a temperature binding                 | ignored                                                     |
| extremes tracker      | restart (rows reloaded from SQLite) for a `sensor`       | envelope restored                                           |
| resolveHistoryBinding | known alias / unknown alias                              | binding type+category / `number`, undefined                 |
| recipe-history        | 1h query on energy equipment                             | calls `queryHistory` with category `energy`, returns points |
| recipe-history        | unknown equipment                                        | `{ points: [] }`, no Influx call                            |
| recipe-history        | Influx not connected                                     | `{ points: [] }`                                            |
| recipe-history        | `queryHistory` throws                                    | `{ points: [] }`, debug log                                 |
| recipe-history        | `from` = -30d                                            | clamped to -7d, one warn per instance                       |
| recipe-history        | 11 queries within 60 s                                   | 11th rejects `history rate limit`                           |
| recipe-history        | 10 queries, 61 s later one more                          | accepted                                                    |
| recipe-history        | two instances, 10 queries each                           | both accepted                                               |
| recipe-manager        | built without `influxClient`                             | `ctx.history` undefined                                     |
| recipe-manager        | built with `influxClient`                                | `ctx.history.query` is a function                           |
| history route (retro) | existing route tests after the extraction                | unchanged                                                   |
