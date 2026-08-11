# Spec 140 — Architecture

## Placement

```
src/energy/
├── capacity-arbiter.ts        # the arbiter (new)
├── capacity-arbiter.test.ts   # unit tests on synthetic + replayed series (new)
├── energy-aggregator.ts       # untouched
└── tariff-classifier.ts       # untouched
```

Wired in `src/index.ts` after `EquipmentManager` and `SettingsManager`, before
`RecipeManager` (recipes need the helper at instance start). The arbiter is
plain core code — not a plugin, not a recipe — because it must outlive any
package and be the single meter reader (spec rationale).

## Data model

### Migration `016_equipment_energy_profile.sql`

```sql
ALTER TABLE equipments ADD COLUMN energy_profile TEXT; -- JSON, nullable
```

```ts
// src/shared/types.ts
export type EnergyLoadClass = "comfort" | "deferrable";

export interface EnergyLoadProfile {
  class: EnergyLoadClass;
  nominalPowerW: number; // user-declared; engage sizing + last-resort reservation
  minOnS: number; // default 900
  minOffS: number; // default 300
  /** Core-maintained rolling estimate from past runs (never edited by the
   *  user form, shown read-only as "measured"). Middle tier of the
   *  effective-watts rule (FR-2). */
  learned?: { watts: number; atIso: string; runs: number };
}

export interface Equipment {
  // ... existing fields ...
  energyProfile?: EnergyLoadProfile; // parsed from energy_profile column
}
```

Profile edits go through the existing equipment update path (admin-gated) and
emit the existing `equipment.updated` event — the arbiter re-reads profiles on
that event. No new table: the profile is an attribute of the equipment, and
`EquipmentWithDetails` already reaches the UI everywhere it is needed.

### Class auto-assignment (overridable)

`defaultEnergyClassFor(type: EquipmentType): EnergyLoadClass | null` in
`src/shared/constants.ts` — Sowel knows its equipments, so the class is
derived and the user only corrects the exceptions:

| EquipmentType                                               | Default class                     | min-on / min-off |
| ----------------------------------------------------------- | --------------------------------- | ---------------- |
| `water_heater`                                              | `deferrable`                      | 300 s / 300 s    |
| `pool_pump`, `water_valve`                                  | `deferrable`                      | 900 s / 300 s    |
| `pool_heat_pump`                                            | `deferrable`                      | 900 s / 600 s    |
| `thermostat`, `heater`                                      | `comfort`                         | 900 s / 600 s    |
| `appliance`, `switch`, `light_*`, everything else orderable | `null` — explicit choice required | 900 s / 300 s    |

The timings are derived from the type for the same reason the class is: Sowel
knows what a `water_heater` is. A relay in front of a resistor pays nothing to
restart, and a blanket 900 s `minOnS` on a 2.2 kW load is up to 0.55 kWh of
grid bought per unresolvable deficit; a compressor is the opposite case and
keeps the conservative default. Both remain editable per equipment.

The mapping feeds the UI pre-selection when the admin enables a profile; it
never enrolls an equipment by itself (enabling stays explicit, and the stored
profile always carries the resolved class — the mapping is a form default,
not a runtime fallback). `nominalPowerW` is pre-filled from the equipment's
own measured power when a `power` data binding or submeter exists (recent
sustained draw), else left blank.

### Settings (existing `settings` table)

| Key                                 | Default | Meaning                                                                 |
| ----------------------------------- | ------- | ----------------------------------------------------------------------- |
| `energy.arbiter.enabled`            | `false` | global switch — default off, zero behavior change until opted in        |
| `energy.arbiter.priority`           | `[]`    | JSON array of equipment ids, ordered, grant top-down / revoke bottom-up |
| `energy.arbiter.engageMarginW`      | `100`   | headroom above claim watts before granting                              |
| `energy.arbiter.engageHoldS`        | `120`   | sustained availability before a grant                                   |
| `energy.arbiter.releaseHoldS`       | `600`   | sustained deficit before a revoke (measured: see review log, spec.md)   |
| `energy.arbiter.smoothingS`         | `60`    | EMA time constant on signed grid power                                  |
| `energy.arbiter.overrideTtlS`       | `7200`  | manual-override suspension                                              |
| `energy.arbiter.staleAfterS`        | `300`   | meter silence before degraded mode                                      |
| `energy.arbiter.divergenceConfirmS` | `60`    | reported state contradicting the grant before it reads as manual        |

The grid meter is auto-detected (the `main_energy_meter` equipment, same
lookup as `src/api/routes/energy.ts#findEnergyEquipmentId`); an optional
`energy.arbiter.meterEquipmentId` overrides it.

Claims and grants are **runtime state only** — deliberately not persisted. On
restart, recipes re-claim in their `createInstance` and the arbiter re-grants
within one engage hold. This kills a whole class of stale-state bugs for the
price of one warm-up period.

## The arbiter

### Inputs

- `equipment.data.changed` for the meter equipment (signed power alias,
  category `power`): feeds the EMA. Timestamps feed staleness.
- `equipment.order.executed` with `source.kind` in
  `{ "manual", "button", "external" }` targeting a profiled equipment:
  manual-override suspension (spec 101's `OrderSource` — already in the event,
  zero new plumbing).
- `equipment.data.changed` on a profiled equipment's own on/off state:
  **state divergence** is the second manual-override trigger. An order event
  only exists when the human went through Sowel; the archetypal flexible load
  does not work that way. A water heater is a contactor with a wall switch
  beside the panel, a pool pump has a manual selector on the box — flipping
  either produces no order, and the arbiter would keep reserving 2 200 W for a
  load somebody killed at the wall, or count as background a load somebody
  forced on. When the reported state contradicts the grant for
  `divergenceConfirmS` (default 60 s — the round-trip lag of a Zigbee relay is
  the floor here), the arbiter treats it exactly as FR-6: revoke
  `manual-override` + suspension. Recipes already detect this on their own
  today; the point of the arbiter is that they should not have to.
- `equipment.updated` / `equipment.removed`: refresh profiles, drop claims on
  removed equipments (revoke `disabled`).
- `settings.changed` on `energy.arbiter.*`: live reconfiguration; disabling
  revokes everything.
- A 10 s internal tick for hold expiries (engage/release/stale/override are
  time-driven, not only event-driven).

### State (in-memory)

```ts
interface ClaimRecord {
  id: string; // uuid
  equipmentId: string;
  instanceId: string; // recipe instance owning the claim
  watts: number; // resolved at claim time (req.watts ?? profile.nominalPowerW)
  toleratedImportW: number; // default 0 — grid the recipe accepts to buy
  slack: "none" | "some" | "high"; // self-demotion only, default "none"
  note?: string;
  status: "pending" | "granted";
  grantedAt?: number; // for minOnS
  lastRevokedAt?: number; // per-equipment, for minOffS
  unresponsiveUntil?: number; // set by the revoke-not-honored watchdog
  onGranted: () => void;
  onRevoked: (reason: CapacityRevokeReason) => void;
}
```

Plus: `emaPowerW`, `lastMeterAt`, `overrides: Map<equipmentId, untilTs>`,
`journal: RingBuffer<ArbiterDecision>` (bounded, e.g. 200 entries — same
pattern as the activity buffer, spec 101).

**Slack is ordering input, never priority.** The user's list stays the sole
authority; `slack` only lets a claim step _down_ inside it. That asymmetry is
what makes it inflation-proof — the failure mode that rules out
recipe-declared priority (every package claims the maximum) has no analogue
when the only reachable move is self-demotion. The arbiter runs the grant pass
in list order over `slack: "none"` claims first, then a second time over the
rest. The motivating consumer is the water heater: a tank at 55 °C with an
off-peak window six hours away is genuinely less urgent than a pool pump that
has not filtered today, and only the recipe knows the tank's state of charge —
the user cannot express "unless it is nearly hot" in a static list.

### Accounting & decision pass (every tick and relevant event)

```
# The grid reading stays SIGNED throughout. Clamping the export at zero
# (a first draft did) discards the magnitude of an import — which is
# precisely the deficit — and makes the release pass unreachable: with
# exportW floored at 0, deficitW can never become positive whatever the
# household does (review decision 10).
signedGridW      = emaPowerW          # > 0 importing, < 0 exporting
exportW          = -signedGridW       # > 0 exporting, < 0 importing

# effective watts per granted claim (FR-2, three tiers):
#   1. smoothed live draw from the load's own power binding, if fresh (<120 s)
#   2. profile.learned.watts, if present
#   3. claim watts (declared / recipe override)
reservedW        = Σ effectiveWatts(granted claims)
availableW       = exportW + reservedW  // reservation accounting: the export
                                        // the meter WOULD show if every
                                        // granted load stopped. This is the
                                        // number shown to the user, and the
                                        // one the day timeline plots.

# stale check
if now - lastMeterAt > staleAfterS: revoke all ("meter-stale"), state=degraded, return

# release pass (bottom-up in user priority order)
#   deficitW ≡ reservedW - availableW - Σ tolerated ≡ signedGridW - Σ tolerated.
#   The identity is the whole point of reservation accounting: "the surplus
#   collapsed" is NOT a deficit (it is our own grant), "the house is importing"
#   is. Tolerated import is per claim (FR-3): an all-or-nothing resistive load
#   may be worth a few hundred watts of grid, a heat pump is not.
deficitW = signedGridW - Σ toleratedImportW(granted claims)
if deficitW > 0 sustained releaseHoldS:
  for eq from lowest priority upward, skipping grants younger than minOnS*
      and grants marked unresponsive†:
    revoke(eq, "surplus-deficit"); deficitW -= effectiveWatts(eq); stop when ≤ 0

# grant pass (top-down), then preemption for whoever it could not serve
#   headroomW ≡ availableW - reservedW ≡ exportW — you can only hand out what
#   is leaving the house right now. `ownDrawW` is what makes an already-running
#   claim grantable at all (FR-3, review decision 11): its draw is already in
#   the meter, so it never appears as free headroom, and without this term the
#   grant a must-run recipe keeps open per author rule 5 can never land.
for eq from highest priority downward with a pending claim, slack "none" first:
  if suspended(eq) or now - lastRevokedAt(eq) < minOffS: continue
  ownDrawW = fresh live draw of eq (tier 1), else 0
  needW    = claim.watts + engageMarginW - claim.toleratedImportW
  if headroomW + ownDrawW ≥ needW sustained engageHoldS:
    grant(eq); headroomW -= max(0, claim.watts - ownDrawW)
  else if eq outranks a granted eq' in the priority list:
    shortfallW = needW - headroomW - ownDrawW
    revoke lower-priority grants bottom-up ("priority-preempted") until
      Σ effectiveWatts(revoked) ≥ shortfallW, then serve eq on the next pass
```

\* A deficit that cannot be resolved because every remaining grant is inside
its `minOnS` simply waits: phase 1 arbitrates an _optimization_ (surplus), so
a few minutes of grid draw is the accepted cost of not short-cycling
compressors. The future kVA phase is the one allowed to bypass the holds.
`minOnS` is therefore a real cost — hence per-type defaults rather than one
global 900 s (see the profile-defaults table above): a relay in front of a
resistor restarts for free and has no business holding 2.2 kW of grid for a
quarter of an hour.

† **Unresponsive grants.** A revoked load whose draw does not fall
(`revoke-not-honored`, FR-9) has had its reservation freed while its
consumption stays in the meter, so the next pass sees the same deficit and
revokes the next load down — a cascade that walks the whole priority list for
one recipe's failure to act. The arbiter therefore marks such an equipment
`unresponsive` for `2 × releaseHoldS`: its measured draw is accounted as
background (it genuinely is), and it is skipped by the release pass, which
turns an unbounded cascade into one wasted revocation. Author rule 5 makes
this situation _expected_, not exceptional: hard-quota loads run without a
grant by design.

Priority preemption is a distinct pass, not a by-product of the deficit one: a
pending high-priority claim does not make the house import, so it produces no
deficit — it produces a _shortfall_ against the grants below it, resolved by
the `priority-preempted` branch above.

**Effective watts details (FR-2).** Per-load live draws use a short EMA
(30 s) on the load's own `power` binding; a binding going silent mid-grant
silently falls back to the learned/declared tier — never a revocation by
itself. After each run (grant → release/revoke, or an `unclaimed-run`
episode), the core updates `profile.learned` with a trimmed median of the
sustained draw, so the middle tier converges on reality within a few runs
even for loads that only report occasionally. A modulating load therefore
frees headroom as it ramps down, and the grant pass can serve the next
pending claim without waiting for a release.

The learner takes **only samples above a fraction of the declared nominal**
(≥ 25 %), never the run as a whole. Thermostatic loads are the reason: a water
heater draws 2 200 W for three hours and then 0 W with the relay still closed,
its own thermostat having opened. A median over the whole episode learns a
diluted figure, the arbiter under-reserves, over-grants, and buys grid — and
`watts-divergence` fires on a profile that was correct all along. Same rule
for the divergence signal: it compares against the sustained draw, not the
episode average.

### Audit signals (FR-9)

All audit-only, journal + structured log, zero enforcement in phase 1:

- **`revoke-not-honored`** — after a revoke, expected export recovery ≈
  revoked watts. If the smoothed export has not risen by ≥ 50 % of that
  within **one `releaseHoldS`** (one hold of grace to act — this fires
  _before_ the deficit hold can re-arm and cascade onto the next load), the
  equipment is marked `unresponsive` for a further `2 × releaseHoldS` and the
  entry is journaled. False positives are possible (a cloud can mask the
  recovery) — acceptable for an audit signal, stated in the journal entry
  copy.
- **`comfort-off-after-revoke`** — an `equipment.order.executed` with
  `source.kind: "recipe"` matching the claiming `instanceId`, an OFF-like
  value, on a `comfort`-class equipment, within `releaseHoldS` of that
  claim's revocation. Detects recipes violating the degrade-never-off
  convention, without countermanding anything.
- **`watts-divergence`** — the learned or measured draw deviates > 30 % from
  the user-declared `nominalPowerW`. Pure transparency: the books already
  follow the measurement (effective-watts rule, FR-2); this entry tells the
  user their declared number is stale and what the system actually uses
  (revised review decision 2).
- **`unclaimed-run`** — an ON-like `equipment.order.executed` with
  `source.kind: "recipe"` on a profiled equipment holding no grant.
  Legitimate (hard-quota must-run fallbacks, author rule 5); journaled at
  info level so a shrunken surplus is explainable.

## Recipe API wiring

`src/recipes/engine/recipe-manager.ts` builds per-instance helpers today
(`getTariff`, `getSunlight` pattern). Extension:

- `ctx.helpers.energy` is built per instance with the `instanceId` captured,
  so every claim is owned. `claimCapacity` validates: arbiter enabled,
  equipment profiled, no existing claim, no active override — else the handle
  is `denied` with a typed reason. Callbacks are invoked through the same
  try/catch guard as event handlers (a throwing recipe callback must never
  break the arbiter — log and continue).
- `stopInstance` calls `arbiter.releaseAllFor(instanceId)` before tearing the
  instance down (mirrors event unsubscription).
- On cores where the arbiter is disabled, the helper still exists but denies
  (`arbiter-disabled`) — recipes distinguish "absent" (old core,
  `ctx.helpers.energy === undefined`) from "present but off" without probing.

## Events & WebSocket

New members of the `EngineEvent` union (naming follows
`equipment.order.executed`):

```ts
| { type: "energy.capacity.granted";  equipmentId: string; instanceId: string; watts: number; note?: string }
| { type: "energy.capacity.revoked";  equipmentId: string; instanceId: string; watts: number; reason: CapacityRevokeReason }
| { type: "energy.capacity.denied";   equipmentId: string; instanceId: string; reason: CapacityDenyReason }
| { type: "energy.capacity.released"; equipmentId: string; instanceId: string }
| { type: "energy.arbiter.status";    state: "active" | "degraded" | "disabled"; availableSurplusW: number | null }
```

All broadcast to WebSocket clients through the existing pipeline (deduplicated
per batch like other high-frequency events; `energy.arbiter.status` emitted on
change only, not per tick). Emitted by core only — the spec 111 plugin emit
allowlist is untouched.

## API routes

- `GET /api/v1/energy/arbiter` → status, available watts, grants, active
  suspensions, journal (auth: any authenticated user; journal carries no
  prices).
- `POST /api/v1/energy/arbiter/resume/:equipmentId` (admin) → lifts a manual
  suspension immediately ("resume control now", FR-6).
- Profile editing rides the existing `PUT /api/v1/equipments/:id`.
- Arbiter settings ride the existing settings routes (admin-gated), priority
  list included.

No claim-related mutation endpoint: claims belong to recipes, not to HTTP.

## UI touchpoints (minimal, phase 1)

1. **Equipment detail** (admin): "Energy management" panel on orderable
   equipments — enable, class (pre-assigned from the type mapping), nominal
   watts (pre-filled from measured power), min-on/min-off. When a manual
   suspension is active, the panel shows "Manual until HH:MM" with a
   "resume control now" button (FR-6). Same panel family as
   `ElectricalMeteringPanel`.
2. **Settings → Administration → Energy**: arbiter card — enable switch,
   priority list (up/down reorder, no drag dependency), thresholds under an
   "advanced" fold.
3. **Energy → Live**: the arbitration surface, mocked up in
   `mockups/arbitration-live.html` (self-contained HTML, light + dark). Three
   stacked pieces:
   - **Allocation bar (now)** — the instant PV production split into
     labeled segments: household background, each granted load
     (name + reserved watts), free surplus; a queue line below names who is
     waiting and why ("Pompe Piscine — besoin 600 W, surplus libre 0,3 kW").
   - **Day timeline** — the available-surplus curve (the _accounting_ value:
     grants do not dent it, only background and weather do) over one lane per
     profiled load in priority order. Segment kinds: granted (plain green),
     HC/fallback `unclaimed-run` (amber hatch), manual suspension (gray
     hatch), pending (dotted outline); revocations are red markers whose
     tooltip carries the journal reason. Hatching doubles as the CVD-safe
     secondary encoding.
   - **Decision journal** — compact list, newest first (time, equipment,
     action, reason, watts), entries reuse `RelativeTime`.
     This is the "why" surface: nothing the arbiter does is invisible.

The whole arbitration surface renders only when the arbiter is enabled. On
installations without a production meter, the settings card states why
arbitration has nothing to do ("no solar production detected") instead of
offering a switch that would animate an empty timeline — a no-PV home never
sees dead arbitration UI.

## Failure modes

| Failure                        | Behavior                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meter silent > staleAfterS     | revoke all (`meter-stale`), `degraded`, auto-recover on data                                                                                                                    |
| Meter equipment deleted        | same as stale, journaled                                                                                                                                                        |
| Recipe callback throws         | caught + logged, arbiter state unaffected                                                                                                                                       |
| Recipe never honors revoke     | reservation freed, `revoke-not-honored` journaled, equipment marked `unresponsive` for `2 × releaseHoldS` — draw counted as background, skipped by the release pass, no cascade |
| Load switched at the wall      | state divergence held `divergenceConfirmS` → revoke `manual-override` + suspension, same as FR-6                                                                                |
| Load draws while claim pending | `ownDrawW` makes it grantable at zero incremental cost — the books become exact instead of showing a permanent `unclaimed-run`                                                  |
| Recipe instance crashes/stops  | `releaseAllFor(instanceId)` frees its claims                                                                                                                                    |
| Arbiter disabled mid-grant     | revoke all (`disabled`) — recipes fall back                                                                                                                                     |
| Equipment removed mid-grant    | revoke (`disabled`), claim dropped                                                                                                                                              |
| Restart                        | claims are runtime-only; recipes re-claim, one engage-hold warm-up                                                                                                              |

## Alternatives considered

- **Convention between recipes** (staggered thresholds/holds): rejected —
  unenforceable across third-party packages, breaks on the first cloud, and
  the isolation model (rightly) prevents recipes from seeing each other.
- **Event-bus contract instead of callbacks**: rejected as the primary
  contract — every recipe would re-implement filtering and edge-guarding
  (see `reference_recipe_rereport_edge_guard`); events remain for
  observability.
- **Arbiter issues orders itself** (turn the pump on/off directly): deferred
  to the kVA phase. Phase 1 keeps a clean layering — arbiter decides, recipes
  act — which also means a buggy arbiter can strand a _reservation_, never a
  _device_.
- **Quota/deadline in core now**: deferred (spec-level decision). The claim
  request object keeps optional reserved fields (`deadline`, `quotaKey`) out
  of the public sketch until that spec exists.
- **Persisted claims**: rejected — restart-safe by reconstruction (recipes
  re-claim), no stale-state class of bugs.
- **Per-class priority lists**: rejected for phase 1 — one global list is
  what "revoke bottom-up" needs; class semantics live recipe-side. Revisit
  with kVA shedding (open question 6).
- **Recipe-declared priority**: rejected, and the rejection is what makes
  `slack` admissible. Priority is a positional good — every package would
  claim the top and the ordering would carry no information. Self-demotion is
  the one direction with no incentive to lie, so the arbiter accepts a claim
  saying "serve me last" and refuses one saying "serve me first".
- **Deficit as "export below a threshold"**: rejected, and it is the trap the
  clamped pseudo-code fell into. The only honest deficit signal is the signed
  grid reading: a collapsed export under an active grant is the arbiter's own
  doing, an import is not.
