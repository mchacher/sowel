# Spec 166 — Plan

## Tasks

### Core

- [x] 1. `src/shared/types.ts` — add `reportNeed(need: boolean): void` to `CapacityClaimHandle`, documented as measurement-first.
- [x] 2. `src/energy/capacity-arbiter.ts` — add `declaredNeed: Map<string, boolean>`.
- [x] 3. Wire `reportNeed` on the handle returned by `claim()`: ignored unless the claim is granted, never throws.
- [x] 4. `checkGrantDraw()` — in the `idle === null` branch, fall back to `declaredNeed`; apply immediately (no `DRAW_CONFIRM_MS`), clear any pending window, journal the transition.
- [x] 5. `clearDrawState()` — also clear `declaredNeed`.
- [x] 6. Tests (below).

### Recipes (separate repos, after the core release)

- [ ] 7. `sowel-recipe-pool-pump-schedule` — report `heatingNeeded()` for the heater claim, and the pump's own wanted state for the pump claim. Both loads are unmetered on the reference installation, so this is where the feature actually shows. Documented as the pattern every capacity-claiming recipe should follow.
- [ ] 8. `sowel-recipe-water-heater-solar` — it has no temperature signal, so it has nothing truthful to declare (it would say `true` for ever, which is already the default). The useful change is different: it holds a **permanent** claim, so once the tank is hot it keeps reserving its watts against lower-priority loads. Detect "granted, contact closed, measured idle for N minutes" and release, with a backoff before re-claiming.

## Test Plan

### Modules to test

- `src/energy/capacity-arbiter.ts` — the resolution order and the declaration lifecycle.

### Scenarios

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Granted, no measurement, `reportNeed(false)` | state `granted-idle`, `draw-stopped` journaled |
| 2 | Granted, no measurement, `reportNeed(true)` | state `granted` |
| 3 | Granted, no measurement, nothing declared | state `granted` (unchanged from today) |
| 4 | Granted, fresh measurement idle, `reportNeed(true)` | state `granted-idle`: the measurement wins |
| 5 | Granted, fresh measurement drawing, `reportNeed(false)` | state `granted`: the measurement wins |
| 6 | `reportNeed(false)` then the measurement arrives | measurement takes over on the next tick |
| 7 | Measurement goes stale after being fresh, declaration present | holds the measured state |
| 8 | Measurement goes stale, no declaration | holds the last state, as today |
| 9 | `reportNeed` on a pending claim | ignored, no state change, no throw |
| 10 | `reportNeed` on a released claim | ignored, no throw |
| 11 | Claim released then re-granted | declaration does not carry over, starts `granted` |
| 12 | `reportNeed(false)` called twice | one journal entry, not two |
| 13 | Declaration flips true -> false -> true | one journal entry per transition, applied on the same tick (no 5 min wait) |
| 14 | A load with a measurement and no declaration | spec 164 behaviour byte for byte |
| 15 | Meter reporting every 180 s contradicts a declaration | the measurement wins and holds, no flapping |
| 16 | First contradicting measurement after a declaration | applied at once, no 5 min wait |
| 17 | Declaration restates what the surface already shows | no journal entry |

### Retro-compat

Scenarios 3, 5, 8 and 14 are the regression guard: an installation where no recipe declares anything must behave exactly as it does on 1.59.0.
