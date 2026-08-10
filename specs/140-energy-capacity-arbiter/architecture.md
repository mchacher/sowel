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
  nominalPowerW: number; // reservation size when a claim omits watts
  minOnS: number; // default 900
  minOffS: number; // default 300
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

| EquipmentType                                                | Default class                     |
| ------------------------------------------------------------ | --------------------------------- |
| `pool_pump`, `pool_heat_pump`, `water_heater`, `water_valve` | `deferrable`                      |
| `thermostat`, `heater`                                       | `comfort`                         |
| `appliance`, `switch`, `light_*`, everything else orderable  | `null` — explicit choice required |

The mapping feeds the UI pre-selection when the admin enables a profile; it
never enrolls an equipment by itself (enabling stays explicit, and the stored
profile always carries the resolved class — the mapping is a form default,
not a runtime fallback). `nominalPowerW` is pre-filled from the equipment's
own measured power when a `power` data binding or submeter exists (recent
sustained draw), else left blank.

### Settings (existing `settings` table)

| Key                            | Default | Meaning                                                                 |
| ------------------------------ | ------- | ----------------------------------------------------------------------- |
| `energy.arbiter.enabled`       | `false` | global switch — default off, zero behavior change until opted in        |
| `energy.arbiter.priority`      | `[]`    | JSON array of equipment ids, ordered, grant top-down / revoke bottom-up |
| `energy.arbiter.engageMarginW` | `100`   | headroom above claim watts before granting                              |
| `energy.arbiter.engageHoldS`   | `120`   | sustained availability before a grant                                   |
| `energy.arbiter.releaseHoldS`  | `600`   | sustained deficit before a revoke (measured: see review log, spec.md)   |
| `energy.arbiter.smoothingS`    | `60`    | EMA time constant on signed grid power                                  |
| `energy.arbiter.overrideTtlS`  | `7200`  | manual-override suspension                                              |
| `energy.arbiter.staleAfterS`   | `300`   | meter silence before degraded mode                                      |

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
  note?: string;
  status: "pending" | "granted";
  grantedAt?: number; // for minOnS
  lastRevokedAt?: number; // per-equipment, for minOffS
  onGranted: () => void;
  onRevoked: (reason: CapacityRevokeReason) => void;
}
```

Plus: `emaPowerW`, `lastMeterAt`, `overrides: Map<equipmentId, untilTs>`,
`journal: RingBuffer<ArbiterDecision>` (bounded, e.g. 200 entries — same
pattern as the activity buffer, spec 101).

### Accounting & decision pass (every tick and relevant event)

```
smoothedExportW  = max(0, -emaPowerW)
reservedW        = Σ watts of granted claims
availableW       = smoothedExportW + reservedW    // reservation accounting

# stale check
if now - lastMeterAt > staleAfterS: revoke all ("meter-stale"), state=degraded, return

# release pass (bottom-up in user priority order)
deficitW = Σ granted watts - availableW           // >0 → over-committed
if deficitW > 0 sustained releaseHoldS:
  for eq from lowest priority upward, skipping grants younger than minOnS*:
    revoke(eq, "surplus-deficit"); deficitW -= watts; stop when ≤ 0

# grant pass (top-down)
headroomW = availableW - Σ granted watts
for eq from highest priority downward with a pending claim:
  if suspended(eq) or now - lastRevokedAt(eq) < minOffS: continue
  if headroomW ≥ claim.watts + engageMarginW sustained engageHoldS:
    grant(eq); headroomW -= claim.watts
```

\* A deficit that cannot be resolved because every remaining grant is inside
its `minOnS` simply waits: phase 1 arbitrates an _optimization_ (surplus), so
a few minutes of grid draw is the accepted cost of not short-cycling
compressors. The future kVA phase is the one allowed to bypass the holds.

Priority preemption is the same machinery: a higher-priority pending claim
that no longer fits creates a deficit against lower-priority grants →
`priority-preempted` revocation bottom-up, then the grant pass serves it.

### Audit signals (FR-9)

All audit-only, journal + structured log, zero enforcement in phase 1:

- **`revoke-not-honored`** — after a revoke, expected export recovery ≈
  revoked watts. If the smoothed export has not risen by ≥ 50 % of that
  within `2 × releaseHoldS`, journal it. False positives are possible (a
  cloud can mask the recovery) — acceptable for an audit signal, stated in
  the journal entry copy.
- **`comfort-off-after-revoke`** — an `equipment.order.executed` with
  `source.kind: "recipe"` matching the claiming `instanceId`, an OFF-like
  value, on a `comfort`-class equipment, within `releaseHoldS` of that
  claim's revocation. Detects recipes violating the degrade-never-off
  convention, without countermanding anything.
- **`watts-drift`** — when the profiled equipment has a `power` data binding:
  compare its smoothed draw while granted against the declared
  `nominalPowerW`; journal an advisory on a sustained > 30 % gap, suggesting
  a profile correction. The reservation math never switches to the measured
  value in phase 1 (review decision 2).
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
3. **Energy → Live**: status strip (state, available surplus, active grants
   and suspensions) + decision journal list (time, equipment, action, reason,
   note). This is the "why" surface; entries reuse `RelativeTime`.

## Failure modes

| Failure                       | Behavior                                                           |
| ----------------------------- | ------------------------------------------------------------------ |
| Meter silent > staleAfterS    | revoke all (`meter-stale`), `degraded`, auto-recover on data       |
| Meter equipment deleted       | same as stale, journaled                                           |
| Recipe callback throws        | caught + logged, arbiter state unaffected                          |
| Recipe never honors revoke    | reservation freed anyway; watchdog journals `revoke-not-honored`   |
| Recipe instance crashes/stops | `releaseAllFor(instanceId)` frees its claims                       |
| Arbiter disabled mid-grant    | revoke all (`disabled`) — recipes fall back                        |
| Equipment removed mid-grant   | revoke (`disabled`), claim dropped                                 |
| Restart                       | claims are runtime-only; recipes re-claim, one engage-hold warm-up |

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
