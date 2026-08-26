# Plan — Spec 162

## Steps

- **1 — Migration 027.** `direct_fraction` on `pv_forecast_sample`, and the
  `pv_health_day` table. Both into `BACKUP_TABLES` in the same commit, since
  spec 161's review found the earlier PV tables missing from it.
- **2 — `src/energy/pv/pv-health.ts`**, pure: `qualifies()`, `dailyRatio()`,
  `rollingNormal()`, `assess()`, `detectionSpeed()`.
- **3 — Tests for step 2**, before wiring anything.
- **4 — Forecaster.** Store `direct_fraction` on the sample; run the daily check
  after the nightly refit; raise and resolve through the alarm events.
- **5 — API.** `GET /energy/pv-health/:equipmentId`.
- **6 — UI.** The card: ratio against its normal, the trailing series, the
  observed detection speed, and the explicit "cannot name a panel".
- **7 — Docs.** `docs/specs-index.md` row.

## Test Plan

### Modules

- `pv-health.ts` — every rule, directly, since it is pure
- `pv-forecaster.ts` — the daily check against a real in-memory SQLite, as the
  spec 160 and 161 tests do
- `energy.ts` route — the refusals

### Scenarios

| Module     | Scenario                                   | Expected                                     |
| ---------- | ------------------------------------------ | -------------------------------------------- |
| pv-health  | hour at 09 h, fraction 0.9                 | not qualifying (outside the midday band)     |
| pv-health  | hour at 12 h, fraction 0.70                | not qualifying (below the knee)              |
| pv-health  | hour at 12 h, fraction null                | not qualifying, never treated as clear       |
| pv-health  | 4 qualifying hours                         | a ratio is produced                          |
| pv-health  | 3 qualifying hours                         | no ratio at all, not a low one               |
| pv-health  | modelled Wh zero                           | no ratio, no division                        |
| pv-health  | normal over fewer than MIN_NORMAL_DAYS     | null, nothing asserted                       |
| pv-health  | normal with one anomalous day              | median unmoved                               |
| pv-health  | 3 days 15 % below normal                   | alert                                        |
| pv-health  | 2 days 15 % below, then one above          | no alert                                     |
| pv-health  | 3 days 8 % below normal                    | no alert, inside the margin                  |
| pv-health  | alert standing, a day comes back above     | resolved                                     |
| pv-health  | detection speed on 5 qualifying days in 14 | slower than on 12 in 14                      |
| pv-health  | detection speed with no qualifying days    | null, not infinity                           |
| forecaster | a qualifying day                           | one row in `pv_health_day`                   |
| forecaster | the same day twice                         | one row, upserted                            |
| forecaster | sustained deficit                          | `system.alarm.raised` once, not once per day |
| forecaster | recovery                                   | `system.alarm.resolved`                      |
| forecaster | no model                                   | nothing computed, nothing raised             |
| forecaster | equipment with no declared array           | skipped                                      |
| route      | unknown equipment                          | 404                                          |
| route      | no forecaster                              | 503                                          |
| route      | no health history                          | 200 with empty series, never 404             |

### Regression

- A sample row written before migration 027 has a null fraction and must never
  qualify.
- The daily check must not run on the provisional clear-sky curve: no model, no
  health.

## Measured constants

The noise table in `spec.md` was re-measured on the reference installation's
constant-capacity window with the criterion actually implemented (direct
fraction, since the plugin publishes no cloud cover). Any change to
`MIN_DIRECT_FRACTION`, the midday band, or `ALERT_MARGIN` invalidates it and must
be re-measured, not argued.
