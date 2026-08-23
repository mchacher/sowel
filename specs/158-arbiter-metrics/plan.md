# Spec 158 — Implementation plan

Branch: `feat/arbiter-metrics`

Small, additive, and entirely outside the control loop. `capacity-arbiter.ts`
is not modified, so the regression surface is the migration, one new route and
the `index.ts` wiring.

## Task breakdown

- [x] 1. Types: `ArbiterDailyLoadMetrics`, `ArbiterDailyHomeMetrics`,
     `ArbiterMetricsResponse` in `src/shared/types.ts`.
- [x] 2. Migration `migrations/025_arbiter_daily_metrics.sql` (two tables).
- [x] 3. `src/energy/arbiter-metrics.ts`: pure `rollupDay()`. Span
     reconstruction reusing `sustainedAfter()`, entering-state lookback,
     short-cycle detection, home-level integration, `idleClaimableExportWh`.
- [x] 4. `src/energy/arbiter-metrics-store.ts`: prepared statements,
     `upsertTick()` writing all rows of a tick in ONE `db.transaction()`,
     `readRange()`, `purgeOlderThan(400)` at boot, never-throw wrapper.
- [x] 5. `src/energy/arbiter-journal-store.ts`: optional `limit` on `range()`
     (additive, existing callers unchanged).
- [x] 6. `src/energy/arbiter-metrics-rollup.ts`: hour-aligned timer, startup
     catch-up run, today + yesterday recompute with one query per day,
     `ROLLUP_ROW_CAP` = 20 000 with a warning log when hit, local-midnight
     computation per spec 061, profile and settings lookup.
- [x] 7. Wire in `src/index.ts` next to the journal and surplus stores; stop the
     timer on shutdown.
- [x] 8. Route `GET /api/v1/energy/arbiter/metrics` in
     `src/api/routes/energy.ts`: query schema, range clamp, name resolution,
     empty-payload path.
- [x] 9. `scripts/energy/arbiter-metrics.ts` + a `scripts/energy/README.md`
     entry.
- [x] 10. Tests (see test plan).
- [x] 11. Validation: `npx tsc --noEmit`, `npx vitest run`,
      `npx eslint src/ --ext .ts`. No UI change, so no UI typecheck needed.
- [x] 12. Agent code review on the branch diff (workflow phase 5). Five blocking
      findings, all fixed: revoke double-counting, the cap truncating the
      lookback instead of the target day, suspensions left open forever,
      a cap asserted only at a mock boundary, and a tautological cursor test.
- [x] 13. Docs: a paragraph in the arbiter section of
      `docs/technical/architecture.md`, the endpoint in
      `docs/technical/api-reference.md`, the spec 158 entry in
      `docs/specs-index.md`. Release notes EN + FR at release time.

## Verification on real data

- [ ] 14. Run the script against a copy of the production database and check the
      figures are plausible against what the arbiter timeline shows for the same
      days. This is the acceptance step that matters: the numbers have to match
      what a human reading the timeline would count.

## Test Plan

### Modules to test

| Module                      | Why                                                  |
| --------------------------- | ---------------------------------------------------- |
| `arbiter-metrics.ts`        | All the derivation logic. Pure, so fully testable    |
| `arbiter-metrics-store.ts`  | Upsert idempotence, single transaction, range, purge |
| `arbiter-metrics-rollup.ts` | Timer alignment, today+yesterday, cap, never-throw   |
| `energy.ts` route           | Query validation, empty payload, range clamp         |

Existing files to follow as patterns, and to extend rather than replace:
`src/energy/arbiter-journal-store.test.ts` (store contract),
`src/energy/arbiter-timeline.test.ts` (`sustainedAfter` semantics).

### Scenarios

| Module          | Scenario                                                        | Expected                                                            |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| arbiter-metrics | Grant 10:00, revoke 12:00, `minOnS` 1800, `releaseHoldS` 600    | `grants` 1, `revokes` 1, `shortCycles` 0, `grantedS` 7200           |
| arbiter-metrics | Grant 10:00, revoke 10:05, same config                          | `shortCycles` 1                                                     |
| arbiter-metrics | Grant 23:00, revoke 01:00 next day                              | 3600 s on day 1, 3600 s on day 2                                    |
| arbiter-metrics | Load already granted at day start (last decision before window) | Entering state honoured, seconds counted from `dayStartMs`          |
| arbiter-metrics | Span still open at day end                                      | Seconds counted up to `dayEndMs`, not to now                        |
| arbiter-metrics | `waiting` then `granted`                                        | `pendingS` covers the gap, `grantedS` starts at the grant           |
| arbiter-metrics | `suspended` with `running: true` then `resumed`                 | `unmanagedS` and `suspendedS` per the timeline semantics            |
| arbiter-metrics | `reset` decision (restart) mid-span                             | Span closes at the reset, no phantom seconds                        |
| arbiter-metrics | Empty decision list                                             | Zero load rows, home row still computed from surplus, no throw      |
| arbiter-metrics | Surplus negative all day                                        | `exportWh` 0, `importWh` > 0, `idleClaimableExportWh` 0             |
| arbiter-metrics | One sample at +1000 W, one idle load with `needW` 600           | `idleClaimableExportWh` = 1000 x 300 / 3600                         |
| arbiter-metrics | Same sample, but the load is granted at that instant            | Not counted as missed                                               |
| arbiter-metrics | Same sample, load idle but `needW` 1500                         | Not counted (the surplus could not have served it)                  |
| arbiter-metrics | Day with 40 surplus samples instead of 288                      | `samples` 40 so the reader can discount the day                     |
| arbiter-metrics | DST day of 23 h and of 25 h                                     | Integrates the real span, no error, no double counting              |
| metrics-store   | Upsert the same day twice                                       | One row, second value wins, no accumulation                         |
| metrics-store   | A tick writing 14 rows                                          | A single transaction is opened, not one per row                     |
| metrics-store   | Range read outside any data                                     | Empty array                                                         |
| metrics-store   | Purge at 400 days                                               | Older rows gone, newer kept                                         |
| metrics-store   | DB throws on write                                              | Logged, swallowed, caller unaffected                                |
| metrics-rollup  | Tick recomputes today and yesterday                             | Two `rollupDay` calls, one `upsertTick`, idempotent across ticks    |
| metrics-rollup  | `rollupDay` throws                                              | Logged, timer survives, next tick runs                              |
| metrics-rollup  | Startup catch-up                                                | One immediate run before the first hourly tick                      |
| metrics-rollup  | A day holding more rows than `ROLLUP_ROW_CAP`                   | Read truncated in SQL, warning logged naming the day, rollup writes |
| metrics-rollup  | `stop()` called                                                 | Timer cleared, no further tick                                      |
| energy route    | Valid range                                                     | 200, both arrays populated, names resolved                          |
| energy route    | Equipment deleted since the rows were written                   | Name falls back to the equipment id, no crash                       |
| energy route    | `from` after `to`                                               | 400                                                                 |
| energy route    | Range wider than 400 days                                       | Clamped, 200                                                        |
| energy route    | No params                                                       | Last 30 days                                                        |
| energy route    | No data at all                                                  | 200 with empty arrays, never 500                                    |
