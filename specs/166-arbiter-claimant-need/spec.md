# Spec 166 — Claimant-declared need for a granted load

## Context

Spec 164 describes a granted load as `granted-idle` when its OWN power measurement sits below the idle threshold. The evidence is deliberately the measurement alone, because a reported relay state lies on an inertial load (#631/#733).

That leaves every load without a dedicated meter permanently undescribed. On the reference installation, two of four arbitrated loads are in that case:

| Load | Own power channel | Notes |
| --- | --- | --- |
| Chauffe-eau | yes | `Legrand_GEM_HotWater` |
| PAC | yes | |
| Pompe Piscine | **no** | exposes `state` only |
| PAC Piscine | **no** | inverter driven by `setpoint`; its `state` is published by `SONOFF_4CH_PRO_PISCINE`, a different device from the one the arbiter commands |

A relay-state fallback was considered and rejected: it would have to be gated both on declared shutdown inertia (`releaseDelayS`, unset on all four loads here) and on the state coming from the commanded device, and it still cannot describe an inverter that has no on/off state at all.

The component that does know is the **claimant**. The pool recipe already computes whether heating is needed (`heatingNeeded()`, water temperature against target with hysteresis). It has no way to say so.

## Requirements

- **FR-1** A claimant can declare, while its claim is granted, whether the load needs to draw right now.
- **FR-2** The declaration is used **only for a grant that no measurement has ever described**. A fresh measurement always wins, and a state a measurement has already set is HELD through staleness rather than handed back to the declaration: what the appliance last actually did outranks what the recipe wants. Without this, a load reporting slower than `LIVE_DRAW_FRESH_MS` would flap between the two sources once per reporting gap, journal entries and all.
- **FR-2b** The first fresh measurement that contradicts a declaration-derived state overturns it **immediately**, without serving `DRAW_CONFIRM_MS`. That window absorbs measurement jitter and a declaration is not a measurement; worse, on a load reporting slower than the freshness window the stale ticks in between reset the window on every pass, so it could never mature and a load drawing 2 kW would read "granted, consuming nothing" for ever.
- **FR-3** With no measurement and no declaration, the load renders exactly as today (solid green, running). No new visual state, no regression.
- **FR-4** The arbiter stays domain-agnostic: it receives a boolean and never inspects appliance semantics (water temperature, setpoint, mode).
- **FR-5** Declaring is the **expected behaviour of every capacity-claiming recipe**, not a crutch for unmetered loads: the claimant owns what its load is meant to do, and the arbiter should not have to infer intent from electricity. It stays technically optional so nothing in the existing recipe supply chain breaks, and a recipe that never declares behaves as it does today.
- **FR-7** The measurement is nonetheless kept as the deciding signal when it exists. The declaration is what the recipe **wants**; the measurement is what the appliance **does**, and the gap between the two is the whole point of spec 164: on the reference installation a recipe wanted to heat while the appliance drew nothing for a week (#732). Making the declaration primary would repaint that week solid green.
- **FR-6** A declaration is scoped to its claim: releasing or revoking the claim clears it, and it never survives into a later grant.

## Resolution order

| Evidence | Resulting state |
| --- | --- |
| fresh own measurement, below idle threshold | `granted-idle` |
| fresh own measurement, at or above threshold | `granted` |
| never measured, `need = false` declared | `granted-idle` |
| never measured, `need = true` declared | `granted` |
| never measured, nothing declared | `granted` |

## Explicitly NOT in scope

- **A fault state.** "Declared needing, measured idle" is NOT a failure: a heat pump between compressor cycles and a water heater whose thermostat has cut off are both in that state and both healthy. Distinguishing a genuine failure needs a duration argument, not a state, and it deserves its own spec measured against real data.
- Changing what a fresh measurement decides. Spec 164's behaviour on metered loads is untouched.
- A relay-state fallback, for the reasons above.
- Any change to grants, revokes, reservations or the spec 158 metric buckets.

## Acceptance criteria

- [x] `CapacityClaimHandle` exposes `reportNeed(need: boolean)`.
- [x] A granted load with no fresh measurement and `need = false` resolves to `granted-idle`, on the roster and on the ribbon's current cell.
- [x] A granted load with no fresh measurement and `need = true` resolves to `granted`.
- [x] A granted load with a fresh measurement resolves from the measurement, whatever was declared.
- [x] A granted load with neither resolves to `granted`, unchanged from today.
- [x] Releasing the claim clears the declaration; a later grant on the same equipment starts undeclared.
- [x] A `draw-stopped` / `draw-started` journal entry is written when the declaration changes the state, so the ribbon's history is consistent with its live cell.
- [x] Existing recipes that never call `reportNeed` behave exactly as before.

## Edge cases

| Case | Expected |
| --- | --- |
| `reportNeed` called on a pending, denied or released claim | Ignored, no throw |
| `reportNeed` called repeatedly with the same value | No journal churn, only transitions are journaled |
| Measurement arrives after a declaration | Measurement takes over on the next tick |
| Measurement goes stale while granted | Holds the measured state, declaration or not |
| Meter reports slower than the freshness window | No flapping: the measurement keeps the state once it has spoken |
| Claim released and re-granted | Declaration does not carry over |
| Two claims on the same equipment | Only the granted one's declaration counts |
