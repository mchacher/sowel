# Spec 185 — Modulating capacity claim

- **Status**: Implemented — AC9 (live, sunny day) pending
- **Date**: 2026-10-03
- **Related**: spec 140 (energy capacity arbiter — amended here), spec 166 (`reportNeed`), spec 182 (EV charger: "modulation is a separate core spec"), spec 183 (electric vehicle); `sowel-recipe-ev-charge-smart` spec 001 (first consumer, binary claim at a fixed current today)
- **Measured context**: dé charger, single phase, 6–16 A in 1 A steps (≈ 1.38–3.68 kW, 230 W per step); the setpoint is confirmed in 1–8 s; the car follows a current change in seconds without pausing.

## Problem

The arbiter (spec 140) grants **binary** claims: a load runs at a declared power or does not run. An EV charger is not binary: it can draw anywhere between its minimum and maximum current. Today the charging recipe must pick one current. Pick it high and the charge only starts on the sunniest hours and imports when a cloud passes; pick it low and most of the surplus is exported while the car charges slowly.

The only way to follow the surplus today is for the recipe to read the meter itself, which spec 140 rule 4 forbids for good reason: a second regulator on the same signal fights the arbiter (the arbiter thinks the charger draws its claimed power and gives the rest to the pool pump; both then oscillate).

The arbiter must be able to **assign a varying power budget** to a load that can follow one.

## Goals

1. A **modulating claim**: a load declares a range (`minW`, `maxW`, `stepW`); once granted, the arbiter assigns it a budget within the range that follows the surplus, and tells the recipe (`onBudget`).
2. **One allocator.** Binary and modulating claims share the user's priority order; a modulating load never starves a binary one ranked above it, and takes what binary loads ranked above it leave.
3. **Stable.** No oscillation with the meter's lag, a cloud does not cause import for longer than today, and budget changes are rate-limited.
4. **Backward compatible.** A claim without `modulation` behaves exactly as today; existing recipes (pool pump, water heater, ev-charge-smart 0.x) are untouched.

## Non-goals

- **A guaranteed floor.** A claim that runs regardless of surplus (the EV recipe's "minimum by departure") stays a recipe concern, as today (run, keep the claim open — spec 140 rule 6).
- **Several modulating loads sharing fairly.** They are served in priority order like binary ones; proportional sharing is a later refinement.
- **Three-phase or phase-switching chargers.** A range is one interval; a 1-phase/3-phase switch is out of scope.
- **The timeline showing power curves.** The roster shows the current budget; a per-step power curve in the timeline is a v2.
- **Modulation driven by the equipment profile.** The range comes from the claim (the recipe derives it from the device's order bounds); the energy profile is unchanged.

## Contract (recipe API — `src/shared/types.ts`)

```typescript
interface CapacityClaimRequest {
  // … existing fields
  /** Spec 185 — a load that can follow a budget. When present, `watts` is ignored. */
  modulation?: { minW: number; maxW: number; stepW: number };
  /** Called with each new budget (W, a multiple of stepW from minW), first right after onGranted. */
  onBudget?: (watts: number) => void;
}
interface CapacityClaimHandle {
  // … existing members
  /** The current budget while granted (modulating claims), else null. */
  budgetW?(): number | null;
}
```

`getCapacityState().grants[]` gains `budgetW?`. A claim with an invalid range (`minW` ≤ 0, `maxW` < `minW`, `stepW` ≤ 0) is denied with a new reason `invalid-modulation`.

## Functional requirements

### Engage and release

- **FR1 — Engage at the minimum.** A modulating claim engages like a binary one, sized on `minW`: `need = minW + engageMarginW − toleratedImportW`, held `engageHoldS`, outside `minOffS`. On grant: `onGranted()`, then `onBudget(initial)` in the same pass.
- **FR2 — Release only at the minimum.** A deficit first lowers modulating budgets (FR6); a modulating load is revoked only when its budget is already `minW` and the deficit still holds `releaseHoldS`, outside `minOnS` — the binary release rules, applied at the minimum.

### Budget

- **FR3 — Target.** For a granted modulating claim: `target = clamp(floorToStep(effectiveDraw + exportW + toleratedImportW − engageMarginW), minW, maxW)`, where `effectiveDraw` is the load's fresh measured draw, else its current budget. Its own draw is never read as surplus gone.
- **FR4 — Raise slowly.** The budget rises only when the unfloored target has stayed at least 1.5 steps above it for `modulationRaiseHoldS` (default 60 s), the hold counting only once the previous change has settled (`modulationSettleS`, default 90 s — counted during it, the meter EMA still shows part of the last step as surplus and the raise overshoots). It rises straight to the held target, floored on the grid.
- **FR5 — Lower fast.** When the unfloored target falls more than half a step below the budget, the budget drops to it (floored) at the next evaluation, with no hold. A second decrease inside the settle window needs the export to have worsened by a step since the first (the meter EMA still shows the first). The half-step margins each way are the hysteresis: with a floored target and no margin, the budget toggled a step every few minutes on a steady surplus.
- **FR6 — Deficit order.** On a deficit, modulating loads are lowered first, lowest priority first, each down to `minW`; binary loads are revoked (existing rules) only when no modulating load can give more.
- **FR7 — Cadence.** Budgets are recomputed on the existing evaluation (meter sample + 10 s tick), but `onBudget` is called only when the budget changes, so at most once per `modulationSettleS` upward.

### Priority with binary claims

- **FR8 — Modulating above a pending binary.** It takes the headroom up to `maxW` first; the binary load below engages only on what is left.
- **FR9 — Modulating below a pending binary.** Its excess over `minW` — of what it really draws, when it draws less than its budget — counts as available to the higher binary claim's engage check (like a pending claim's own draw does today). When that claim engages, the modulating budget is lowered in the same pass by what the grant needs, down to `minW`.
- **FR10 — Preemption.** A `slack: "none"` claim short of headroom first lowers lower-priority modulating budgets to `minW`, then revokes lower-priority loads (existing preemption).

### Accounting and audits

- **FR11 — Accounting.** For a modulating load, the second accounting tier (today the learned watts) is its current budget. The learner skips modulating loads (a median of budget-driven draw is meaningless). `watts-divergence` compares the measured draw with the budget, not with `maxW`.
- **FR12 — Budget not honoured.** After a budget decrease of Δ, the export must recover by at least 50 % of Δ within `releaseHoldS`; otherwise `budget-not-honored` is journaled and the excess (measured − budget) is counted as background, as for an unresponsive revoke today.
- **FR13 — Manual override unchanged.** A manual, button or external order on the equipment — including a current change — suspends it for `overrideTtlS`, as for any load.

### Visibility

- **FR14 — Journal, coalesced.** Grant (with the initial budget) and revoke are journaled as today. Budget changes are journaled as `budget-changed` only when the budget moved by at least `budgetJournalStepW` (1000 W) since the last journaled value, or `budgetJournalMinS` (900 s) has passed with a change; a value left unjournaled is written once that window passes, so the journal ends on the real budget.
- **FR15 — Event.** `energy.capacity.budget { equipmentId, instanceId, watts }` on every applied change; deduplicated per equipment on the WebSocket topic.
- **FR16 — Read model.** `ArbiterLoadInfo` gains `modulation` and `budgetW`; the arbitration surface shows "budget / max" (e.g. "2.3 / 3.7 kW") for a modulating load. Journal kind labelled EN/FR.
- **FR17 — Shortfall simulation** (`simulateShortfalls`, #807) mirrors the new pass, so the roster never contradicts the engine.

### Recipe author rule (docs)

- **Rule 7** (added to the six of spec 140): a modulating claimant applies each budget promptly — within `modulationSettleS` — and never draws above it; it keeps `reportNeed`.

## Acceptance criteria

- [x] AC1 — With no `modulation`, every existing arbiter test passes unchanged and the behaviour is identical.
- [x] AC2 — A modulating claim engages at `minW` and follows a rising surplus up to `maxW`, rising only after the hold and the settle window.
- [x] AC3 — A surplus drop lowers the budget at the next evaluation; a modulating load is revoked only at `minW` after `releaseHoldS`.
- [x] AC4 — With a binary claim ranked above, a lower modulating load yields its excess so the binary one engages; ranked below, the binary load engages only on what the modulating one leaves.
- [x] AC5 — On a simulated plant with meter lag, a 3.7 kW surplus with ±500 W noise converges without oscillation (budget changes bounded per hour).
- [x] AC6 — A budget decrease not followed is journaled `budget-not-honored` and does not shed the next load.
- [x] AC7 — The journal holds at most one `budget-changed` per 15 min unless the budget moved ≥ 1 kW.
- [x] AC8 — The arbitration surface shows budget / max for the charger.
- [ ] AC9 — Live (owner's installation, sunny day): the EV recipe in modulating mode follows the surplus with grid import no worse than the binary mode, and no load starved.

## Edge cases

| Case                                         | Expected                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| Meter stale                                  | Revoke all (existing `meter-stale`), modulating included                 |
| Load not drawing (car full, paused)          | `granted-idle` as today; budget kept; `reportNeed(false)` frees headroom |
| Recipe never calls back / ignores `onBudget` | FR12 watchdog; excess counted as background                              |
| `minW` above any possible surplus            | Never engages (pending), like a binary load too big for the surplus      |
| Tolerated import set on the profile          | Counted once in the target (FR3) and once in the deficit, as today       |
| Arbiter disabled / denied                    | Denied as today; the recipe falls back to its own mode                   |
| Older core (no `modulation` support)         | The field is ignored: binary claim at `watts` — recipes pass `watts` too |
