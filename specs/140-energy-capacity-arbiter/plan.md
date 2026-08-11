# Spec 140 — Implementation Plan

> **Status: steps 1-7 DONE** (this PR). Step 8 (consumer recipes) follows
> the core release, per the rollout plan below.

## Steps

1. **Types & constants** — `EnergyLoadClass`, `EnergyLoadProfile`,
   `CapacityRevokeReason`, `CapacityDenyReason`, claim handle types, the five
   `energy.*` engine events, `Equipment.energyProfile`. (~0.5 d)
2. **Migration 016** — `equipments.energy_profile` column + parse/serialize in
   the equipment manager + surface in `EquipmentWithDetails`. (~0.5 d)
3. **Capacity arbiter core** — `src/energy/capacity-arbiter.ts`: EMA,
   reservation accounting with the three-tier effective watts (live draw /
   learned nominal / declared), learned-nominal updates after runs,
   grant/release passes, min-on/min-off, override suspension, staleness,
   decision journal, events. Pure logic separated from wiring for
   testability (same style as `tariff-classifier`). (~2.5 d, tests included
   — the largest block, driven by the test plan below)
4. **Recipe helper** — `ctx.helpers.energy` in `recipe-manager.ts`,
   per-instance ownership, auto-release on stop, callback guards. (~1 d)
5. **API route + WS** — `GET /api/v1/energy/arbiter`, event broadcast,
   settings keys. (~0.5 d)
6. **UI** — equipment "Energy management" panel, settings card with priority
   list, Live page arbitration surface (allocation bar + day timeline +
   journal — design mocked in `mockups/arbitration-live.html`). (~2 d)
7. **Docs** — `recipe-development.md` (author rules from spec.md §"Rules for
   recipe authors"), `api-reference.md`, `data-model.md`,
   `architecture.md` energy section, specs-index row. (~0.5 d)
8. **Consumer recipes** (separate repos, after the core release):
   - `sowel-recipe-smart-cooling` v1.4 — the boost engage/release moves to
     `claimCapacity()`; the whole v1.3 logic (surplus thresholds + off-peak
     window) is kept verbatim as the standalone fallback. On a no-PV home,
     an older core, or a disabled arbiter, behavior is byte-for-byte
     today's. `sowelVersion` stays `>=1.31.1` (optional chaining, the
     spec 138 precedent).
   - `sowel-recipe-water-heater-smart` v0.8 — the `solarMode` threshold family
     (6 slots, `computeSurplus`, the self-draw add-back, the
     start/stop coherence check) collapses into one claim carrying
     `toleratedImportW` and a state-of-charge-driven `slack`; the floor and
     off-peak cycles keep their claim open under author rule 5. The v0.7
     logic stays verbatim as the standalone fallback. This is the consumer
     that exercises tolerated import, already-running grants, `slack` and
     wall-switch override — schedule it first, not last.
   - Tariff-scheduler recipe (core issue #392) — gains optional surplus
     claims on top of its tariff placement; tariff-only remains its complete
     mode, not a degraded one.
     (~1.5 d across the three repos)

Total: ~7.5 days. Steps 1-4 are mergeable without any UI (arbiter observable
through logs + API); 5-6 can follow in the same PR or a second one.

### Suggested validation on the reference installation

Before writing the UI, replay the recorded July-August meter series (energy
history API, 1 h resolution is enough for shape; 30 s synthetic
interpolation for hold timings) against the arbiter with two simulated
claims (AC 2000 W, pump 600 W) and assert the acceptance criteria of
spec.md — the same series that exposed the problem should demonstrate the
fix.

## Test plan

### Modules to test

- `capacity-arbiter` (new) — all arbitration logic
- `recipe-manager` (extended) — helper lifecycle
- `equipment-manager` (extended) — profile column round-trip

### Scenarios

| Module            | Scenario                                                          | Expected                                                                                        |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| capacity-arbiter  | Single claim, surplus above watts+margin for engageHoldS          | granted, `energy.capacity.granted`, journal entry                                               |
| capacity-arbiter  | Surplus present but < watts+margin                                | stays pending, no grant                                                                         |
| capacity-arbiter  | Grant then own-consumption export collapse                        | **no revoke** — reservation accounting keeps availableW stable                                  |
| capacity-arbiter  | Background surge (hob): deficit sustained releaseHoldS            | bottom-up revoke `surplus-deficit`, deficit resolved, journal                                   |
| capacity-arbiter  | Deficit but all grants younger than minOnS                        | no revoke until minOnS elapses (no short-cycle)                                                 |
| capacity-arbiter  | Revoked equipment re-claimable only after minOffS                 | pending until minOffS, then grantable                                                           |
| capacity-arbiter  | Two claims, surplus fits only one                                 | higher-priority granted, lower stays pending                                                    |
| capacity-arbiter  | Higher-priority claim arrives, no headroom                        | lower-priority revoked `priority-preempted`, higher granted                                     |
| capacity-arbiter  | Cloud pass shorter than releaseHoldS                              | no revocation (hysteresis)                                                                      |
| capacity-arbiter  | Manual order (`source.kind: "manual"`) on granted equipment       | immediate revoke `manual-override`, suspension, claims denied `override-active` until TTL       |
| capacity-arbiter  | Recipe/mode order (`source.kind: "recipe"`) on granted equipment  | **no** override (the claiming recipe acting is normal)                                          |
| capacity-arbiter  | Meter silent > staleAfterS                                        | revoke all `meter-stale`, status `degraded`, event                                              |
| capacity-arbiter  | Fresh meter data after degraded                                   | status `active`, pending claims grantable again                                                 |
| capacity-arbiter  | Disable via settings                                              | revoke all `disabled`; enable restores arbitration                                              |
| capacity-arbiter  | Claim on non-profiled equipment                                   | denied `not-profiled`                                                                           |
| capacity-arbiter  | Second claim on claimed equipment                                 | denied `equipment-already-claimed`                                                              |
| capacity-arbiter  | Claim watts omitted                                               | engage sized on profile nominal; reservation follows effective watts                            |
| capacity-arbiter  | Equipment removed while granted                                   | revoke `disabled`, claim dropped                                                                |
| capacity-arbiter  | Callback throws in onGranted/onRevoked                            | caught, logged, arbiter continues                                                               |
| capacity-arbiter  | Journal bound                                                     | oldest entries evicted at capacity                                                              |
| capacity-arbiter  | Learned/measured draw > 30 % off declared nominal                 | `watts-divergence` transparency entry; books already on measurement                             |
| capacity-arbiter  | Granted modulating load ramps down (power binding)                | reservation follows live draw; freed headroom grants the next pending claim                     |
| capacity-arbiter  | Load's power binding silent mid-grant                             | fallback to learned/declared tier, no revocation                                                |
| capacity-arbiter  | Run completes on a metered load                                   | `profile.learned` updated (trimmed median), used by the next grant                              |
| capacity-arbiter  | Unmetered load                                                    | reservation = claim/declared watts (tier 3), everything else unchanged                          |
| capacity-arbiter  | OFF order from claiming instance on comfort equipment post-revoke | `comfort-off-after-revoke` journal anomaly, no countermanding                                   |
| capacity-arbiter  | Recipe ON order on profiled equipment with no grant               | `unclaimed-run` info journal entry; accounting treats the draw as background                    |
| capacity-arbiter  | Grant lands on an already-running load (rule 5 must-run)          | no duplicate accounting: available stays on the true surplus                                    |
| capacity-arbiter  | Import under active grants (clamped-export regression guard)      | positive deficit, bottom-up revoke — the pre-fix draft produced deficit 0 here                  |
| capacity-arbiter  | Pending claim on a load already drawing power                     | granted on `headroom + ownDraw`; `availableSurplusW` unchanged by the grant                     |
| capacity-arbiter  | Revoked load whose draw does not fall                             | marked `unresponsive`, counted as background, release pass skips it — next load keeps its grant |
| capacity-arbiter  | `toleratedImportW` set                                            | engage widened and release narrowed by exactly that amount; 0 reproduces strict behavior        |
| capacity-arbiter  | `slack: "high"` on the top-priority claim                         | lower-priority claim served first; no claim field can raise a claim in the list                 |
| capacity-arbiter  | Profiled equipment flipped at the wall (state change, no order)   | after `divergenceConfirmS`: revoke `manual-override` + suspension, as FR-6                      |
| capacity-arbiter  | Thermostatic load cycling to zero mid-grant                       | `profile.learned` unaffected (sub-threshold samples dropped), no `watts-divergence`             |
| capacity-arbiter  | Per-type profile defaults                                         | `water_heater` pre-fills 300/300, `pool_heat_pump` 900/600, both editable                       |
| capacity-arbiter  | POST resume/:equipmentId during suspension                        | suspension lifted immediately, pending claims grantable                                         |
| capacity-arbiter  | Replay: two-consumer July series                                  | zero synchronized engage/release pairs; grants strictly follow priority                         |
| recipe-manager    | Instance stop with active claim                                   | claim auto-released, reservation freed                                                          |
| recipe-manager    | Helper on disabled arbiter                                        | claim denied `arbiter-disabled` (helper present)                                                |
| recipe-manager    | Two instances claim two different equipments                      | independent grants, independent revocations                                                     |
| equipment-manager | Profile write/read round-trip                                     | JSON column parsed into `energyProfile`, absent → undefined                                     |
| equipment-manager | Invalid profile JSON in DB                                        | logged warn, treated as unprofiled (no crash)                                                   |

### Retro-compat

| Scenario                                       | Expected                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Arbiter disabled + no profiles (default state) | zero behavior change: no events, no journal, no meter subscription work beyond a cheap guard |
| Existing recipes (no claims)                   | unaffected; `ctx.helpers.energy` presence is additive                                        |
| Older recipe on newer core                     | never sees a callback it did not register; nothing to migrate                                |

## Rollout

1. Merge behind the default-off setting (`energy.arbiter.enabled = false`).
2. Enable on the reference installation; profile the pool pump (deferrable,
   600 W) and the AC (comfort, 2000 W); watch the journal for a week.
3. Ship the consumer recipe updates (step 8): `smart-cooling` v1.4, then the
   tariff scheduler. Core first, recipes after — never the reverse.
4. **Validate the no-production path** on the demo instance (no PV): the same
   recipes run with their surplus features inert and their tariff/comfort
   value intact, and the UI shows no dead arbitration surface.
5. Then only: documentation pass for community recipe authors and the store
   template update.
