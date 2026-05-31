# Spec 119 — Implementation plan

## Task breakdown (in implementation order)

### Phase A — types

- [ ] A1. `src/shared/types.ts` — extend `EnergyHistoryResponse.resolution`
      literal to include `"1mo"`. No new fields.
- [ ] A2. `ui/src/types.ts` — mirror the literal extension so the web
      UI compiles.

### Phase B — server helpers

- [ ] B1. `src/api/routes/energy.ts` — add private `getServerTz()`
      reading `process.env.TZ` with `"Europe/Paris"` fallback. Log
      the resolved value once at module load.
- [ ] B2. `src/api/routes/energy.ts` — add private
      `expectedBucketTimes(from, to, resolution)` that returns the
      UTC ISO timestamps of the N buckets a per-period query is
      expected to produce. Pure function, testable in isolation.

### Phase C — `computeRange`

- [ ] C1. Update `computeRange()` so: - week returns `resolution: "1d"` (was `"1h"`) - year returns `resolution: "1mo"` (was `"1d"`) - day / month unchanged.

### Phase D — Influx query helpers

- [ ] D1. Refactor `queryEnergyHpHcPoints` to use the generalised
      template (`every: $resolution`, `location: $tz`,
      `createEmpty: true`). Remove the
      `needsAggregation = "1h" && !bucket` branch — always
      `aggregateWindow`.
- [ ] D2. Same refactor for `queryEnergyLegacyPoints`.
- [ ] D3. Same refactor for `queryProductionPoints`.
- [ ] D4. Same refactor for `querySubmeterPoints` (used by
      `/by-usage`).

### Phase E — Route handlers

- [ ] E1. `/api/v1/energy/history` — replace the per-time-merge that
      only pushes "non-empty" points with one that walks
      `expectedBucketTimes(from, to, resolution)` and pushes every
      expected bucket (with zeros when no Influx row matched).
- [ ] E2. `/api/v1/energy/by-usage` — same per-submeter merge update.

### Phase F — Documentation

- [ ] F1. `docs/technical/api-reference.md` — update the two endpoint
      sections to document the new per-period bucket count and the
      always-N response semantics.

## Test Plan

The test plan is the contract that the implementation must satisfy.

### Modules to test

- `src/api/routes/energy.ts` — per-period bucket count, TZ-alignment,
  HP/HC preservation, empty-bucket handling, leap-year edge case,
  future-date edge case.

### Test file location + framework

- `src/api/routes/energy.test.ts` (new file, mirrors pattern from
  `equipments.test.ts` and `audit.test.ts`).
- Vitest, already configured.
- Mock `influxClient.getClient()` to return a stub whose
  `getQueryApi().iterateRows(flux)` yields prepared rows. The Flux
  query string is not asserted byte-for-byte; instead the test
  asserts the **observable response shape** (point count + time
  alignment + values).

### Scenarios

| #   | Endpoint  | Scenario                                                              | Expected response                                                                                   |
| --- | --------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | /history  | `?period=day&date=2026-05-30` with 12 hours of data                   | `points.length == 24`, hours 0..11 with values, hours 12..23 with hp=hc=prod=auto=inj=0             |
| 2   | /history  | `?period=week&date=2026-05-30` (Saturday) with 3 days of data         | `points.length == 7`, Mon-Wed populated, Thu-Sun zero                                               |
| 3   | /history  | `?period=month&date=2026-02-15` (non-leap)                            | `points.length == 28`                                                                               |
| 4   | /history  | `?period=month&date=2024-02-15` (leap year)                           | `points.length == 29`                                                                               |
| 5   | /history  | `?period=year&date=2026-06-15`                                        | `points.length == 12`, Jan-May populated, Jun current, Jul-Dec zero                                 |
| 6   | /history  | HP/HC preservation on `?period=week`                                  | each daily point has `hp` and `hc` independently set (not collapsed into a single field)            |
| 7   | /history  | `?period=year` against a fresh install (no Influx data at all)        | `points.length == 12`, all zero, no throw                                                           |
| 8   | /history  | `response.resolution`                                                 | `"1h"` for day, `"1d"` for week/month, `"1mo"` for year                                             |
| 9   | /history  | Invalid `period` (e.g. `period=hour`)                                 | 400 with the existing error message (unchanged)                                                     |
| 10  | /history  | Date in the future (`?period=year&date=2030-06-15`)                   | `points.length == 12`, all zero, no throw                                                           |
| 11  | /by-usage | `?period=week` returns 7 daily points **per submeter**                | every `submeters[i].points.length == 7`                                                             |
| 12  | /by-usage | `?period=year` returns 12 monthly points per submeter                 | every `submeters[i].points.length == 12`                                                            |
| 13  | helpers   | `expectedBucketTimes(from, to, "1d")` against a CEST/CET DST boundary | bucket Sunday-of-transition still returns one bucket, sum-of-bucket covers the 23h or 25h local day |
| 14  | helpers   | `getServerTz()` with `process.env.TZ` set                             | returns the env value                                                                               |
| 15  | helpers   | `getServerTz()` with `process.env.TZ` unset                           | returns `"Europe/Paris"`                                                                            |

### Coverage check after implementation

- [ ] Every scenario row above has a corresponding `it(...)` block.
- [ ] Each `it` block has at least one expectation that would fail
      against the current (pre-spec-119) behaviour, proving the spec
      change is what the test validates.

## Manual verification on dev / demo

After PR is open and tests pass, before requesting merge:

- [ ] On `domopi.local:3001` (demo instance), hit
      `curl 'http://demo.api/.../energy/history?period=year&date=2026-01-01'`
      and confirm `points.length == 12` with sensible HP / HC monthly totals.
- [ ] Open the Energy page in the demo UI, switch to Year view,
      confirm the chart still renders 12 bars exactly as before
      (visual regression check).
- [ ] Repeat for Week and Month views.

## Rollout notes

- No DB migration.
- No new env vars (we reuse `TZ` already set in `docker-compose.yml`).
- No new event types.
- Backwards-compat is wire-format-preserving (response shape stays
  `EnergyHistoryResponse`). Existing consumers see denser content
  (fewer points for week / year, plus zero-filled empties) but the
  contract holds.
