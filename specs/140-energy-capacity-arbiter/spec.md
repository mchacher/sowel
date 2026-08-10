# Spec 140 — Energy Capacity Arbiter

- **Status**: DRAFT — submitted for contributor review, not implemented
- **Date**: 2026-08-10
- **Related**: spec 138 (recipe tariff helper), spec 126 (`getSunlight()` helper pattern), spec 111 (plugin soft isolation), spec 101 (OrderSource)
- **Consumers identified**: `sowel-recipe-smart-cooling` (v1.4 candidate), tariff-aware quota scheduler recipe (core issue #392), any future surplus-aware recipe

## Problem

Every recipe that reacts to solar surplus controls on a **threshold over grid
export** and therefore consumes the very signal it observes. Measured on the
reference installation with a single such recipe (`smart-cooling`, engage at
500 W sustained export, disengage below 100 W for 10 min): the AC engages,
absorbs the surplus, the export collapses, and ten minutes later the recipe
releases — a self-oscillation bounded only by its own hold timers (10-15 min
cycles). With one recipe this is a tolerable design compromise. With two or
more, the behavior becomes genuinely indeterminate:

- **Synchronized yo-yo**: an 800 W surplus makes a 2 kW AC boost _and_ a 600 W
  pool pump both see "≥ 500 W sustained", engage together for 2.6 kW, kill the
  export, release together, repeat.
- **Starvation**: the recipe with the shortest hold always wins the surplus;
  the other never runs.
- **No global order**: nothing expresses "the AC boost matters more than the
  pool pump" across recipe packages.

No discipline at the recipe level can fix this: recipes are isolated from each
other by design, and staggering thresholds between packages is a convention
that breaks on the first cloud. The coordination point must be **one core
component that is the only reader of the meter** and that performs
**reservation accounting**: when it grants 2 000 W to a load, it knows the
export collapse that follows is its own decision, not a disappearance of the
surplus.

This is a **platform primitive**, and its timing matters: today exactly one
published recipe hand-rolls surplus logic. Every additional surplus-aware
recipe published before the primitive exists is one more migration later.

## Concepts

### Three classes of load

| Class                                       | Examples                        | Relationship to the arbiter                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Background** (not pilotable)              | induction hob, oven, TV, lights | Never declared, never arbitrated. Absolute priority _de facto_: the arbiter only sees them through the meter and adapts around them.                                                                            |
| **Comfort** (pilotable in boost, never off) | AC, heaters                     | Baseline operation is NOT arbitrated — a hot house gets its AC, grid or not, exactly as today. Only the _bonus_ (pre-cool boost) goes through a claim, and revoking a bonus degrades to baseline, never to off. |
| **Deferrable** (pilotable on/off)           | pool pump, water heater, EV     | Fully arbitrated and preemptible at any time — time-shifting is their nature. Their "must eventually run" guarantee is quota/deadline logic, which stays **in the recipe** in this phase (see Non-goals).       |

The class is a property of the equipment (energy profile), never of a recipe —
and Sowel already _knows_ its equipments: `EquipmentType` is a closed enum, so
the class is **auto-assigned from the type and overridable by the user**. A
`pool_pump` or `water_heater` defaults to `deferrable`, a `thermostat` or
`heater` to `comfort`; types with no obvious energy semantics (`appliance`,
`switch`, lights) get no default and require an explicit choice. Enabling the
profile stays an explicit admin action — auto-assignment removes friction, it
never enrolls a load under arbitration by itself. The nominal watts are
pre-filled from the equipment's own measured power when a metering binding
exists (e.g. a clamp submeter), editable as well.

### User-owned priority

Priority is a single **ordered list of equipments** maintained by the user in
the UI. It is read top-down to grant and bottom-up to revoke. Recipes never
declare their own priority — if they could, every package would claim the
maximum and the system would collapse by inflation. Recipes express _needs_
(watts); the user expresses _order_; the platform enforces it.

### Reservation accounting

```
availableSurplusW = smoothedGridExportW + Σ grantedW(active grants)
```

The arbiter reserves the declared watts of every active grant. A drop in
export caused by its own grants does not read as "surplus gone". A drop
_beyond_ the reserved total means background consumption rose (someone turned
the hob on) → revoke bottom-up until the balance is restored.

## In scope (phase 1)

1. **Energy profile on Equipment** (opt-in, admin UI): class
   (`comfort | deferrable`), nominal watts, min-on / min-off durations.
2. **Capacity arbiter** in core (`src/energy/`): single reader of the main
   meter, smoothing, reservation accounting, grant/revoke engine driven by the
   user priority list, hysteresis and anti-short-cycle guards.
3. **Recipe API** (`ctx.helpers.energy`): claim capacity for a profiled
   equipment, receive grant/revoke callbacks, release. Read-only state
   inspection. Auto-release when the recipe instance stops.
4. **Manual override**: a manual/button/external order on a profiled equipment
   pauses its arbitration for a TTL (existing `OrderSource` tells origins
   apart). The human always wins.
5. **Fail-safe**: stale meter data revokes everything and idles the arbiter;
   global kill-switch; every decision logged and visible (decision journal in
   the UI, "why" first-class).
6. **Events + WebSocket** so the UI (and curious recipes) can observe
   decisions.

## Non-goals (phase 1)

- **No quota / deadline scheduling** in core. A deferrable recipe keeps its
  own fallback plan (e.g. HC windows via `getTariff()`, spec 138) and treats
  surplus grants as opportunistic. The claim API is forward-compatible
  (optional fields reserved) so a later spec can move quota placement into
  core without breaking recipes.
- **No kVA ceiling / emergency shedding**. That phase adds hard enforcement
  (arbiter-issued orders, comfort-class guards like temperature floors). In
  phase 1 the arbiter issues **no orders at all** — recipes act, the arbiter
  decides.
- **No production forecast**, no modulating loads (on/off semantics only —
  a comfort boost is "on" at the recipe's discretion), no multi-meter
  topologies, no per-phase (three-phase) accounting.

## Functional requirements

- **FR-1** An admin can mark an _orderable_ equipment as a flexible load with
  `{ class, nominalPowerW, minOnS, minOffS }`. The class is pre-assigned from
  `EquipmentType` (see architecture.md mapping) and the nominal watts
  pre-filled from measured power when available; both are overridable.
  Enabling the profile remains an explicit action, and non-profiled
  equipments cannot be claimed.
- **FR-2** The arbiter is the only component reading the grid meter for
  arbitration purposes. It smooths the signed power (EMA, default 60 s) and
  maintains `availableSurplusW` by reservation accounting.
- **FR-3** Grants follow the user priority list: highest-priority pending
  claim is granted when `availableSurplusW ≥ claimW + engageMarginW` sustained
  for `engageHoldS`; on sustained deficit, grants are revoked bottom-up.
  `minOnS` / `minOffS` are respected for surplus decisions (only the future
  kVA phase may bypass them).
- **FR-4** One active claim per equipment, whole system. A second claim is
  denied with an explicit reason. Claims are runtime-only (not persisted);
  recipes re-claim on start.
- **FR-5** Recipes interact exclusively through `ctx.helpers.energy` —
  callbacks, not meter reads. A recipe whose instance stops has its claims
  auto-released. On cores without the helper, recipes degrade to their own
  fallback (same contract as `getTariff()` absence).
- **FR-6** A manual, button, or external order on a profiled equipment revokes
  its grant (`reason: "manual-override"`) and suspends arbitration of that
  equipment for `overrideTtlS` (default 2 h).
- **FR-7** No meter update for `staleAfterS` (default 300 s) → revoke all
  grants (`reason: "meter-stale"`), arbiter state `degraded`. Disabling the
  arbiter revokes all grants (`reason: "disabled"`). Both are ordinary,
  observable transitions for recipes — which then fall back, as they must
  anyway.
- **FR-8** Every transition (grant, revoke, deny, release, degrade) is logged
  (pino, structured) and appended to a bounded in-memory decision journal
  exposed to the UI. Nothing ever happens without a visible reason.
- **FR-9** A revoked grant whose measured effect does not materialize (export
  does not recover within a watchdog window) is logged and journaled as
  `revoke-not-honored` — audit only in phase 1, no enforcement.

## How recipes use it

This is the heart of the spec — the API below is what contributor review
should challenge first.

### API sketch

```ts
// ctx.helpers.energy — all optional-chaining safe (absent on cores < this spec)
interface EnergyHelpers {
  /**
   * Claim surplus capacity for a profiled equipment. Resolves the declared
   * profile; `watts` overrides the profile's nominalPowerW when the recipe
   * knows better (e.g. AC boost differs from compressor nominal).
   * Exactly one active claim per equipment, system-wide.
   */
  claimCapacity(req: {
    equipmentId: string;
    watts?: number;
    /** Free-text shown in the decision journal ("precool boost"). */
    note?: string;
    onGranted: () => void;
    onRevoked: (reason: CapacityRevokeReason) => void;
  }): CapacityClaimHandle;

  /** Read-only snapshot for conditions and instance state. */
  getCapacityState(): {
    enabled: boolean;
    availableSurplusW: number | null; // null while degraded/stale
    grants: Array<{ equipmentId: string; watts: number; sinceIso: string }>;
  };
}

interface CapacityClaimHandle {
  readonly id: string;
  status(): "pending" | "granted" | "denied" | "released";
  deniedReason?:
    | "not-profiled"
    | "equipment-already-claimed"
    | "arbiter-disabled"
    | "override-active";
  /** Withdraw the claim; releasing a granted claim frees the reservation. */
  release(): void;
}

type CapacityRevokeReason =
  | "surplus-deficit" // background rose or clouds came
  | "priority-preempted" // a higher-priority claim needed the watts
  | "manual-override" // the user touched the equipment
  | "meter-stale"
  | "disabled";
```

Callbacks rather than bus events, deliberately: the recipe never filters a
global stream, edge-guarding is structural (a callback fires exactly once per
transition), and the arbiter knows exactly who to notify on revocation.
Matching `energy.capacity.*` engine events exist for the UI and observers, but
the _contract_ with the claiming recipe is the callback pair.

### Worked example 1 — Smart Cooling v1.4 (comfort boost)

Today: reads grid power, engages precool at ≥ 500 W export held 15 min,
disengages below 100 W held 10 min. Both constants and both timers disappear:

```ts
// hot day detected, boost wanted:
claim = ctx.helpers.energy?.claimCapacity({
  equipmentId: pacId,
  watts: 2000,
  note: "precool boost",
  onGranted: () => enterPrecool(), // power on + precool setpoint
  onRevoked: () => backToComfortSetpoint(), // degrade to baseline — never off
});
// evening / no longer hot:
claim?.release();
```

If `ctx.helpers.energy` is undefined (older core) or the claim is denied, the
recipe keeps its current standalone behavior — the exact code it has today
becomes the fallback branch. Revocation degrades the _boost_; the AC's
baseline comfort operation never depends on a grant (comfort class).

### Worked example 2 — pool pump (deferrable, opportunistic)

A filtration recipe with a daily quota keeps its plan (HC windows via
`getTariff()`, spec 138) and layers surplus on top:

```ts
claim = ctx.helpers.energy?.claimCapacity({
  equipmentId: pumpId, // watts defaults to profile (600)
  note: "filtration on surplus",
  onGranted: () => pumpOn(),
  onRevoked: () => pumpOff(), // deferrable: off, catch up later
});
// each hour served on surplus reduces what the HC fallback must place tonight
```

The "it must really run today" guarantee is the recipe's quota fallback, not
the claim — a deferrable load losing its grant loses nothing but time.

### Worked example 3 — the heat-wave dinner scenario

16:30, heat wave. AC boost granted (2 000 W), pump granted (600 W), induction
hob turns on (3 000 W, background). Smoothed export collapses far beyond the
2 600 W reserved → deficit. The arbiter revokes bottom-up per the user's list:
pump first (`surplus-deficit`) — recipe turns the pump off, will catch up in
HC tonight; if still short, the AC boost (`surplus-deficit`) — recipe returns
to the comfort setpoint, unit stays on. Nobody touched the hob, nobody
switched the AC off, and every step is one line in the decision journal.

### Rules for recipe authors (to be documented in recipe-development.md)

1. A claim is a _bonus_, never a plan. Always keep a standalone fallback
   (tariff windows, fixed schedule, thresholds) — it is also your behavior on
   cores without the arbiter, when the arbiter is disabled, and after
   `meter-stale`.
2. Act on callbacks immediately; the reservation is freed at revocation, and
   consumption is expected to follow. Not honoring a revoke is detected and
   journaled (FR-9).
3. Never read the grid meter to decide _whether_ to consume when a claim is
   possible — that is the arbiter's job, and private meter logic reintroduces
   the oscillation this spec removes.
4. `release()` when the need disappears (evening, quota met) — do not hold
   grants you no longer use; the watts belong to the next load in the list.

## Acceptance criteria

- [ ] Two concurrent surplus consumers (simulated Smart Cooling + pump) on a
      replayed meter series show zero synchronized oscillation: grants follow
      the priority list, revocations are bottom-up, and available accounting
      never double-counts a granted load's own consumption.
- [ ] A background surge (hob scenario) revokes bottom-up within
      `releaseHoldS`, comfort claims degrade (never off), deferrable claims
      stop.
- [ ] Manual order on a granted equipment → immediate revoke + suspension for
      `overrideTtlS`; claims during suspension are denied `override-active`.
- [ ] Meter silence > `staleAfterS` → all grants revoked `meter-stale`,
      arbiter `degraded`, recovery re-arms automatically on fresh data.
- [ ] Recipe instance stop auto-releases its claims.
- [ ] Second claim on an already-claimed equipment denied
      `equipment-already-claimed`.
- [ ] `minOnS`/`minOffS` honored for surplus decisions (no flapping on a
      cloud pass shorter than the holds).
- [ ] Every transition appears in the decision journal with equipment,
      watts, reason, and origin claim note.
- [ ] All-off default: arbiter disabled and no profiles → strictly zero
      behavior change anywhere in the engine.

## Open questions for review

1. **API shape**: callbacks (`onGranted`/`onRevoked`) vs engine-bus
   subscription vs both — is the callback contract right for recipe authors?
   (Current draft: callbacks are the contract, events are observability.)
2. **Namespace**: `ctx.helpers.energy.claimCapacity()` vs flat
   `ctx.helpers.claimCapacity()` — spec 138 chose flat (`getTariff`), this
   draft opens a namespace because a family is coming (state, later quota).
3. **Watts trust**: the accounting trusts declared watts. Should a power data
   binding on the equipment, when present, refine the reservation with the
   measured draw (and how fast)?
4. **Comfort semantics**: is "revoke = degrade, never off" better enforced by
   convention (recipe-side, current draft) or should the arbiter refuse
   `deferrable`-style claims on `comfort`-class equipments entirely?
5. **Defaults**: engage 120 s hold / release 300 s hold / EMA 60 s /
   override TTL 2 h / stale 300 s — sane for real PV installations?
6. **Priority UI**: one global ordered list (current draft) vs per-class
   lists. One list is simpler and matches "revoke bottom-up"; is it enough?
