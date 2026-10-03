# Spec 185 — Plan

## Steps and estimate

| #   | Step                                                                                                                       | Effort              |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | Types, request validation (`invalid-modulation`), recipe-manager wiring, event, WS dedup                                   | 0.5 d               |
| 2   | Plant test harness (closed loop, lag, noise, EMA)                                                                          | 0.5 d               |
| 3   | Budget pass (FR3–FR7) + accounting (FR11) + tests                                                                          | 1.5 d               |
| 4   | Release pass step-down, preemption, binary/modulating priority (FR2, FR6, FR8–FR10) + tests                                | 1.5 d               |
| 5   | Budget watchdog (FR12), journal coalescing (FR14), `simulateShortfalls` (FR17) + tests                                     | 1 d                 |
| 6   | Full regression (171 existing arbiter tests, metrics, timeline, API)                                                       | 0.5 d               |
| 7   | UI (FR16), i18n, docs EN/FR                                                                                                | 1 d                 |
| 8   | Agent review, fixes, PR                                                                                                    | 0.5–1 d             |
| 9   | `sowel-recipe-ev-charge-smart` spec 002: modulating claim from the charger's current bounds, `onBudget` → `charge_current` | 0.5–1 d             |
|     | **Total**                                                                                                                  | **7.5–9 d** of work |
| 10  | Live tuning on the owner's installation (sunny days): hold/settle values, AC9                                              | calendar            |

Margin: the upper bound assumes two tuning rounds on step 3–4 after the plant tests expose oscillations.

## Test plan

| Module                 | Scenario                                                 | Expected                                                                    |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| arbiter (existing 171) | Unchanged                                                | All pass (AC1)                                                              |
| arbiter                | Invalid range                                            | Denied `invalid-modulation`                                                 |
| arbiter                | Surplus 2 kW steady, range 1380–3680/230                 | Granted, `onGranted` then `onBudget(≤ 2 kW step)`                           |
| arbiter                | Surplus ramps 1.5 → 3.7 kW                               | Budget rises after `raiseHoldS`, not within `settleS`                       |
| arbiter                | Surplus drops 3.7 → 2 kW                                 | Budget lowered at the next evaluation                                       |
| arbiter                | Surplus below `minW`                                     | Budget at `minW`; revoked after `releaseHoldS`, not within `minOnS`         |
| arbiter                | Binary claim above, pending, modulating below at 3.7 kW  | Binary engages using the modulating excess; budget lowered in the same pass |
| arbiter                | Modulating above, binary below                           | Binary engages only on what is left                                         |
| arbiter                | `slack: "none"` short                                    | Modulating lowered to `minW` before any revoke                              |
| arbiter                | Deficit with two binary and one modulating               | Modulating lowered first, then binary revoked                               |
| arbiter (plant)        | 3.7 kW ± 500 W noise, meter EMA 60 s, load lag 10 s, 2 h | Bounded budget changes (≤ 12/h), import ≤ binary mode                       |
| arbiter (plant)        | Load ignores a decrease                                  | `budget-not-honored`; next load not shed                                    |
| arbiter                | Many small changes                                       | ≤ 1 `budget-changed` per 15 min unless ≥ 1 kW                               |
| arbiter                | Learner, `watts-divergence`                              | Skipped / compared to budget                                                |
| arbiter                | `simulateShortfalls`                                     | Agrees with the engine for a modulating roster                              |
| recipe-manager         | `modulation`, `onBudget`, `budgetW()`, grants copy       | Passed through                                                              |
| API / WS               | Public state fields; event dedup                         | Present; one per equipment per batch                                        |
| UI                     | Roster shows budget / max; journal kinds labelled        | Rendered EN/FR                                                              |
