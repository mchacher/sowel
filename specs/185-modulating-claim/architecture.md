# Spec 185 — Architecture

The arbiter (`src/energy/capacity-arbiter.ts`, 2105 lines) keeps its structure: one meter, one evaluation per sample and per 10 s tick, a release pass then a grant pass, audits after. A modulating claim is a **granted claim with a budget**; the status machine (pending / granted / denied / released) is unchanged.

## Data

| Where                                 | Change                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ClaimRecord` (L96-111)               | `modulation?`, `budgetW`, `lastBudgetChangeAt`, `targetAboveSince`, `lastJournaledBudgetW/At`         |
| `CapacityClaimRequest/Handle` (types) | `modulation?`, `onBudget?`, `budgetW?()`; deny reason `invalid-modulation`                            |
| `ArbiterLoadInfo`, `getCapacityState` | `modulation`, `budgetW`                                                                               |
| `ArbiterDecision.kind`                | `budget-changed`, `budget-not-honored` (+ EN/FR labels, dot colours)                                  |
| Events                                | `energy.capacity.budget`                                                                              |
| Config (`energy.arbiter.*`)           | `modulationRaiseHoldS` 60, `modulationSettleS` 90, `budgetJournalStepW` 1000, `budgetJournalMinS` 900 |
| Persistence                           | none new: the journal's `watts` column carries the budget; no migration                               |

## Evaluation (per pass)

```
release pass (deficit ≥ releaseHoldS)                      grant pass (top-down: slack, priority)
  1. lower modulating budgets, lowest priority first,        for each claim:
     each to minW, until the deficit is covered                binary pending   → existing engage check, where
  2. then revoke (existing), modulating only at minW                              headroom += Σ excess of LOWER
                                                                                  modulating grants (FR9)
                                                              modulating pending → engage on minW (FR1)
budget pass (new, after the grant pass)                        binary granted   → nothing
  for each granted modulating claim, priority order:           modulating granted → budget pass
    target = clamp(floorStep(draw + export + tol − margin), min, max)
    lower now if target ≤ budget − step (FR5)
    raise if target ≥ budget + step held raiseHoldS and settle elapsed (FR4)
    headroom −= (newBudget − draw) for the claims below
    onBudget(newBudget) if changed; event; coalesced journal
```

A binary engage lowering a modulating budget (FR9/FR10) happens in the grant pass, with the same synchronous callback discipline and the existing re-entrancy guard (L1270-1289).

## Sites touched (from the arbiter map)

| Site                                                     | Change                                                                                 | Size     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| `engageNeedW` (L2019)                                    | `minW` for modulating                                                                  | small    |
| Grant pass (L1366-1420)                                  | excess of lower modulating grants counts for higher binary engage; lower them on grant | redesign |
| New budget pass                                          | FR3–FR7                                                                                | new      |
| Release pass (L1333-1363)                                | step-down before shedding; revoke modulating only at minW                              | redesign |
| Preemption (L1397-1418)                                  | modulating excess first                                                                | medium   |
| `simulateShortfalls` (L1107-1138)                        | mirror                                                                                 | medium   |
| `effectiveWatts` / `drawEstimate`                        | tier 2 = budget                                                                        | small    |
| Learner (L457-466, L1910)                                | skip modulating                                                                        | small    |
| `watts-divergence` (L1424-1439)                          | compare to budget                                                                      | small    |
| Watchdogs (L1592-1603, L1684-1741)                       | budget-decrease watchdog, partial background excuse                                    | medium   |
| `checkGrantDraw`, divergence, override                   | unchanged                                                                              | —        |
| Metrics rollup (`arbiter-metrics-rollup.ts:197`)         | `needW` from `minW`                                                                    | small    |
| `recipe-manager.ts` (613-647)                            | pass `modulation`/`onBudget`, `budgetW()`, grants copy                                 | small    |
| WebSocket (`websocket.ts:264`, UI `useWebSocket.ts:446`) | dedup key and refresh for the new event                                                | small    |
| UI `ArbitrationSurface.tsx`                              | budget / max in the watts column                                                       | small    |
| UI journal (`ArbiterTimeline.tsx`), colours, i18n        | two kinds                                                                              | small    |

## Test harness

The current harness (`capacity-arbiter.test.ts:35-277`) feeds the meter open-loop. Modulation needs a **plant**: `export = production − base − Σ load draw`, where a modulating load's draw follows its last budget after a configurable lag, plus an optional noise and a meter EMA. Convergence, oscillation bounds and the watchdog are tested on it; the 171 existing tests stay as they are (AC1).

## Docs

`docs/technical/architecture{,.fr}.md` (arbiter section), `docs/deep-dives/surplus-arbiter{,.fr}.md`, `docs/technical/recipe-development{,.fr}.md` (energy: modulation, rule 7), `docs/technical/api-reference{,.fr}.md` (arbiter state fields), `docs/technical/data-model/equipments.md` (claim), release notes.
