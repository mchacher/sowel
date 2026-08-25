# Plan — Spec 161

## Steps

- **1 — Types.** `SolarProfile.since?: string` in `src/shared/types.ts` and in
  `ui/src/types.ts`. No migration: the column already holds JSON.
- **2 — Pairing module.** `src/energy/pv/pv-backfill.ts`: `resolveWindow()` and
  `pairHistory()`, both pure. Reuses `solarPosition` / `toDni` / `planeOfArray`.
- **3 — Tests for step 2**, before wiring anything.
- **4 — Forecaster.** `backfill()`: read `irradiance_history`, query production
  from Influx, pair, upsert samples, fit, store with the declared capacity.
- **5 — API.** `POST /energy/pv-forecast/:id/backfill`, admin, with the four
  refusal paths from the architecture.
- **6 — Route + validation.** `since` through the equipments body schema and the
  shared validator.
- **7 — Plugin 2.3.0.** `fetchIrradianceHistory`, published once a day.
- **8 — UI.** Date field on the declaration form, one action and its report on
  the panel (spec 160's recalibration button withdrawn), EN/FR strings.
- **9 — Docs.** `docs/specs-index.md` row, plugin README.

## Test Plan

### Modules to test

- `pv-backfill.ts` — the window and the pairing (pure, so directly)
- `pv-forecaster.ts` — `backfill()` against a real in-memory SQLite, as the
  spec 160 capacity tests do
- `energy.ts` route — the refusal paths
- `equipments.ts` route — `since` reaches the manager
- plugin `open-meteo.ts` — the history parse

### Scenarios

| Module           | Scenario                                | Expected                                             |
| ---------------- | --------------------------------------- | ---------------------------------------------------- |
| pv-backfill      | no `since`                              | window is exactly 45 days, `boundedBy: "window"`     |
| pv-backfill      | `since` 9 days ago                      | window starts at `since`, `boundedBy: "declaration"` |
| pv-backfill      | `since` 90 days ago                     | 45-day bound wins                                    |
| pv-backfill      | `since` in the future                   | ignored, 45-day bound                                |
| pv-backfill      | `since` unparseable                     | ignored, 45-day bound                                |
| pv-backfill      | production hour with no irradiance      | skipped, not zeroed                                  |
| pv-backfill      | irradiance hour with null direct        | skipped                                              |
| pv-backfill      | night hours                             | excluded, POA is zero                                |
| pv-backfill      | hour_local matches the live path        | same value `collectSample` would write               |
| pv-backfill      | production above the impossible ceiling | left in; `fitModel` excludes it, as live             |
| forecaster       | backfill with no declared array         | refused                                              |
| forecaster       | backfill with no published history      | refused, distinct reason                             |
| forecaster       | backfill twice                          | row count unchanged, no double-count                 |
| forecaster       | enough hours                            | model fitted, `fitted_peak_wc` = declared            |
| forecaster       | fewer than MIN_SAMPLES paired           | samples written, no model, reason reported           |
| forecaster       | existing model                          | replaced, capacity stamp set                         |
| route            | not admin                               | 403                                                  |
| route            | unknown equipment                       | 404                                                  |
| route            | forecaster absent                       | 503                                                  |
| equipments route | `since` forwarded to the manager        | present in the update input                          |
| plugin           | history response parsed                 | daylight hours only, nulls preserved                 |
| plugin           | history fetch fails                     | forward series still published                       |

### Regression

- A backfilled sample and a live sample for the same hour must be equal. Asserted
  by driving both paths over the same inputs.
- The forward path must not read `since` at all.

## Order of merge

Stacked on `feat/pv-production-forecast` (#711). Retarget to `main` once that
merges. The plugin 2.3.0 release and the registry `sha256` bump follow the same
rule as 2.2.0: published before the core release that needs it.
