# Spec 140 — Energy Capacity Arbiter

- **Status**: IMPLEMENTED (phase 1) — spec reviewed by maintainer + contributor before implementation; consumer-recipe updates (plan step 8) follow the core release
- **Date**: 2026-08-10
- **Related**: spec 138 (recipe tariff helper), spec 126 (`getSunlight()` helper pattern), spec 111 (plugin soft isolation), spec 101 (OrderSource)
- **Consumers identified**: `sowel-recipe-smart-cooling` (v1.4 candidate), `sowel-recipe-water-heater-smart` (v0.8 candidate — the deferrable stress case, worked example 2b), tariff-aware quota scheduler recipe (core issue #392), any future surplus-aware recipe

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

This is a **platform primitive**, and its timing matters: two published
recipes already hand-roll surplus logic — `smart-cooling` above, and
`water-heater-smart`, which carries its own copy of the reservation trick
(it adds the heater's own draw back into the export, or closing the relay
would immediately re-open it) precisely because one recipe alone can do that
correctly and two cannot. Every additional surplus-aware recipe published
before the primitive exists is one more migration later.

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

The arbiter reserves the **effective watts** of every active grant — the
load's smoothed measured draw when it has a power binding, else a learned
nominal from past runs, else the declared profile watts (FR-2). A drop in
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
   — or a sustained divergence between its reported state and its grant, which
   is what a wall switch looks like — pauses its arbitration for a TTL
   (existing `OrderSource` tells origins apart). The human always wins,
   including the human who never opened the app.
5. **Fail-safe**: stale meter data revokes everything and idles the arbiter;
   global kill-switch; every decision logged and visible (decision journal in
   the UI, "why" first-class).
6. **The arbitration surface** on Energy → Live — essential, not a nicety
   (FR-10): the instant allocation bar with its waiting queue, the day
   timeline, and the decision journal. `mockups/arbitration-live.html` is the
   normative reference design. An invisible arbiter reads as magic or as a
   bug; this surface is what makes it trustworthy.
7. **Events + WebSocket** so the UI (and curious recipes) can observe
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
- **No production forecast**, no modulation _control_ (the arbiter never
  commands a power level; loads that modulate on their own are handled by the
  effective-watts accounting, FR-2), no multi-meter topologies, no per-phase
  (three-phase) accounting.

## Functional requirements

- **FR-1** An admin can mark an _orderable_ equipment as a flexible load with
  `{ class, nominalPowerW, minOnS, minOffS }`. The class is pre-assigned from
  `EquipmentType` (see architecture.md mapping) and the nominal watts
  pre-filled from measured power when available; both are overridable.
  Enabling the profile remains an explicit action, and non-profiled
  equipments cannot be claimed.
- **FR-2** The arbiter is the only component reading the grid meter for
  arbitration purposes. It smooths the signed power (EMA, default 60 s) and
  maintains `availableSurplusW` by reservation accounting. The reserved watts
  of a granted load are its **effective watts**: smoothed live draw when a
  fresh `power` binding exists, else the learned nominal from past runs, else
  the declared profile watts. A claim's `watts` field sizes the engage
  decision only. The grid reading stays **signed** end to end: the deficit the
  release pass acts on is an _import_, not a low export, and clamping the
  export at zero would erase exactly the quantity being measured.
- **FR-3** Grants follow the user priority list: highest-priority pending
  claim is granted when free headroom (plus the load's own draw when it is
  already running) covers `claimW + engageMarginW − toleratedImportW`
  sustained for `engageHoldS`; on sustained deficit, grants are revoked
  bottom-up. Three refinements make the rule usable by real loads:
  - **Tolerated import** — a claim may declare `toleratedImportW` (default 0),
    the grid draw the recipe accepts to buy in exchange for the surplus it
    does catch. An all-or-nothing 2.2 kW resistive load is the case: refusing
    to run until the surplus covers it entirely wastes most of a day's export,
    and the recipes doing this by hand today all carry such a tolerance.
  - **Already-running claims** — the grant test adds the load's own measured
    draw to the headroom. Without it, a load running under author rule 5 can
    never be granted (its consumption has already depressed the export it
    would have to be granted from), and the "books become exact when the grant
    lands" guarantee is unreachable.
  - **Slack** — a claim may declare `slack: "none" | "some" | "high"` to step
    _down_ the user's list. It cannot step up: self-demotion is the only
    ordering signal a recipe cannot gain by lying about, which is what
    separates it from the recipe-declared priority this spec rejects.
    `minOnS` / `minOffS` are respected for surplus decisions (only the future
    kVA phase may bypass them) and default **per equipment type**, not globally:
    a relay in front of a resistor restarts for free, a compressor does not.
- **FR-4** One active claim per equipment, whole system. A second claim is
  denied with an explicit reason. Claims are runtime-only (not persisted);
  recipes re-claim on start.
- **FR-5** Recipes interact exclusively through `ctx.helpers.energy` —
  callbacks, not meter reads. A recipe whose instance stops has its claims
  auto-released. On cores without the helper, recipes degrade to their own
  fallback (same contract as `getTariff()` absence). The same contract covers
  homes with **no solar production at all** — a first-class, permanent
  configuration, not an edge case: every consumer recipe must deliver its
  full non-surplus value (tariff windows, schedules, comfort logic) with its
  surplus features simply inert, whether the arbiter is absent, disabled, or
  present on an installation that never exports.
- **FR-6** A manual, button, or external order on a profiled equipment revokes
  its grant (`reason: "manual-override"`) and suspends arbitration of that
  equipment for `overrideTtlS` (default 2 h). **A sustained divergence between
  the equipment's reported state and its grant is the same event**: the
  archetypal flexible load has a physical switch — a water heater contactor
  beside the panel, a pool pump selector on the box — and using it produces no
  Sowel order at all. Held for `divergenceConfirmS` (default 60 s), it revokes
  and suspends exactly as an order would. The suspension is first-class in
  the UI: the equipment card shows "Manual until HH:MM" and offers a "resume
  control now" action that lifts it immediately.
- **FR-7** No meter update for `staleAfterS` (default 300 s) → revoke all
  grants (`reason: "meter-stale"`), arbiter state `degraded`. Disabling the
  arbiter revokes all grants (`reason: "disabled"`). Both are ordinary,
  observable transitions for recipes — which then fall back, as they must
  anyway.
- **FR-8** Every transition (grant, revoke, deny, release, degrade) is logged
  (pino, structured) and appended to a bounded in-memory decision journal
  exposed to the UI. Nothing ever happens without a visible reason.
- **FR-9** Audit-only signals — with one bounded exception, below — each logged
  and journaled: `revoke-not-honored` (a revoked grant whose measured effect
  never materializes within one `releaseHoldS` of grace; this one **also**
  marks the equipment `unresponsive` for `2 × releaseHoldS`, so its draw is
  accounted as
  background and the release pass skips it — the reservation was freed while
  the consumption stayed, and without the guard the arbiter revokes the next
  load down, and the next, cascading through the list for one recipe's
  inaction. Author rule 5 makes unhonored revokes an expected state, not an
  anomaly), `comfort-off-after-revoke` (an OFF
  order from the claiming instance on a comfort-class equipment right after a
  revocation — the recipe violates the degrade-never-off convention),
  `watts-divergence` (the learned or measured draw deviates > 30 % from the
  user-declared nominal — transparency entry: the books already follow the
  measurement, this tells the user their profile number is stale), and
  `unclaimed-run` (a profiled equipment switched on by a recipe
  holding no grant — legitimate for hard-quota fallbacks, and it explains a
  shrunken surplus to whoever reads the journal).
- **FR-10** Energy → Live ships the **arbitration surface**; phase 1 is not
  complete without it: (a) the instant allocation bar — production split into
  named segments (background, each granted load with its effective watts,
  free surplus) plus the waiting queue stating why each pending claim waits;
  (b) the day timeline — the available-surplus curve (the accounting value)
  over one lane per profiled load, segment kinds granted / unclaimed-run /
  manual / pending, revocation markers carrying the journal reason; (c) the
  decision journal in human language. `mockups/arbitration-live.html` is the
  normative reference design (light and dark).

## How recipes use it

This is the heart of the spec — the API below is what contributor review
should challenge first.

### API sketch

```ts
// ctx.helpers.energy — all optional-chaining safe (absent on cores < this spec)
interface EnergyHelpers {
  /**
   * Claim surplus capacity for a profiled equipment. `watts` sizes the
   * ENGAGE decision only (how much headroom must be available before the
   * grant); it overrides the profile's nominal when the recipe knows better
   * (e.g. AC boost differs from compressor nominal). Once granted, the
   * reservation follows the load's effective watts (measured live draw,
   * else learned nominal, else declared — FR-2).
   * Exactly one active claim per equipment, system-wide.
   */
  claimCapacity(req: {
    equipmentId: string;
    watts?: number;
    /**
     * Grid draw this recipe accepts to buy in exchange for catching the
     * surplus (default 0). An all-or-nothing resistive load that refuses to
     * start until the export covers it whole catches almost nothing.
     */
    toleratedImportW?: number;
    /**
     * Step DOWN the user's priority list — never up. Lets a recipe say what
     * the static list cannot know: its own state of charge. A water heater
     * at 55 °C with an off-peak window six hours away sets "high" and lets
     * the pump below it go first; near its floor it sets "none".
     */
    slack?: "none" | "some" | "high";
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

### Worked example 2b — smart water heater (deferrable, the stress test)

`sowel-recipe-water-heater-smart` is the load that exercises every corner of
this spec at once, and it is worth walking because each corner produced a
requirement above.

It drives a bare relay in front of a 2.2 kW resistor whose own mechanical
thermostat ends the cycle; the recipe detects "tank full" from the power
collapsing while the relay is still closed, and learns how long a full heat-up
takes. It heats for three reasons, in priority order: a **temperature floor**
(the tank is cold, someone needs a shower — runs at peak price if it must), an
**off-peak bulk cycle** placed so it _finishes_ as the window closes, and
**solar surplus** the rest of the time. Today that third branch is 100 lines
of hand-rolled threshold logic including the self-draw add-back this spec
exists to delete.

- It is **all-or-nothing at 2.2 kW** and has no restart cost → `minOnS` 300 s
  (FR-3) and a `toleratedImportW` around 200 W, which is the tolerance its
  current form already exposes to the user.
- Its two top reasons are **must-run**: the floor cannot wait for a grant, and
  the off-peak cycle is placed by tariff, not by sun. Both run under author
  rule 5 with the claim held open — so both depend on already-running claims
  being grantable, and on unhonored revokes not cascading.
- On an installation with an **afternoon off-peak window** (the Enedis pattern
  this spec cites for pool pumps), that must-run cycle is 2.2 kW appearing at
  14:00, in full sun, next to a pool pump claiming the same surplus. Whether
  the arbiter can regularise it or must count it as a mystery hole in the
  surplus decides whether the pump gets starved.
- Its **state of charge is invisible to the priority list** and known to the
  recipe alone → `slack`.
- Its manual override is **a switch on the wall**, not a Sowel order → FR-6
  state divergence. The recipe carries its own divergence detector today,
  which is exactly the kind of per-recipe reimplementation this spec removes.
- Its thermostat makes it **cycle to zero while granted** → the learner must
  ignore sub-threshold samples, or the profile drifts and `watts-divergence`
  cries wolf.

**Hard quotas larger than the cheap windows** (a 12 h filtration against 8 h
of HC) are the stress case, and the resolution rests on one principle: **a
grant is never required to run**. The arbiter coordinates surplus; it does not
gate operation. The recipe holds a time-budget invariant — when
`remaining quota ≥ remaining usable time`, it enters must-run mode and simply
switches the load on, grant or not, peak price or not. Deadline beats
priority _by construction_, because priority only governs grants and grants
are optional. While force-running, the recipe **keeps its claim open** (author
rule 5): if the grant arrives, the arbiter's books become exact at once — the
load's draw is already in the meter, so `export + granted` lands on the true
surplus — and either way the journal shows an `unclaimed-run` entry instead of
a mystery hole in the surplus. Core-side quota placement with deadline
escalation is exactly the phase 2 follow-up this API keeps room for.

**Window preference is recipe policy too.** Pool care actually recommends
_daytime_ filtration (algae are photosynthetic, UV eats chlorine while the
water is unstirred; night running is a tariff habit, not a pool practice —
frost protection excepted). A pool recipe therefore composes the three
platform primitives into a preference order: surplus claims first (daytime
and free), then the _daytime_ off-peak window when one exists
(`getTariff()` × `getSunlight()` — the Enedis afternoon HC windows land
exactly here), night HC as the fallback of last resort, and peak-price
daytime only under must-run pressure. The arbiter stays deliberately
time-agnostic; _when_ a load should prefer to run is domain knowledge, and
domain knowledge lives in recipes.

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
   cores without the arbiter, when the arbiter is disabled, after
   `meter-stale`, and on the many homes with **no solar production**, where
   your non-surplus features are the entire product. Tariff-only is a
   complete mode, never a degraded one.
2. Act on callbacks immediately; the reservation is freed at revocation, and
   consumption is expected to follow. Not honoring a revoke is detected and
   journaled (FR-9).
3. Never read the grid meter to decide _whether_ to consume when a claim is
   possible — that is the arbiter's job, and private meter logic reintroduces
   the oscillation this spec removes.
4. `release()` when the need disappears (evening, quota met) — do not hold
   grants you no longer use; the watts belong to the next load in the list.
5. Hard-quota loads: when your deadline forces you to run without a grant,
   run — but **keep the claim open while you do**. A grant landing on an
   already-running load makes the arbiter's accounting exact (your draw is
   already in the meter), and the `unclaimed-run` journal entry tells the
   user why the surplus looks short. Never release a claim just because you
   decided to run anyway.

## Acceptance criteria

- [x] Two concurrent surplus consumers (simulated Smart Cooling + pump) on a
      replayed meter series show zero synchronized oscillation: grants follow
      the priority list, revocations are bottom-up, and available accounting
      never double-counts a granted load's own consumption.
- [x] A background surge (hob scenario) revokes bottom-up within
      `releaseHoldS`, comfort claims degrade (never off), deferrable claims
      stop.
- [x] Manual order on a granted equipment → immediate revoke + suspension for
      `overrideTtlS`; claims during suspension are denied `override-active`.
- [x] Meter silence > `staleAfterS` → all grants revoked `meter-stale`,
      arbiter `degraded`, recovery re-arms automatically on fresh data.
- [x] Recipe instance stop auto-releases its claims.
- [x] Second claim on an already-claimed equipment denied
      `equipment-already-claimed`.
- [x] `minOnS`/`minOffS` honored for surplus decisions (no flapping on a
      cloud pass shorter than the holds).
- [x] Every transition appears in the decision journal with equipment,
      watts, reason, and origin claim note.
- [x] All-off default: arbiter disabled and no profiles → strictly zero
      behavior change anywhere in the engine.
- [x] "Resume control now" lifts a manual suspension immediately.
- [x] Audit signals fire on their patterns: `watts-divergence` (learned or
      measured draw > 30 % off the declared nominal), `comfort-off-after-revoke`,
      `unclaimed-run` (profiled equipment running grantless).
- [x] Tiered effective watts: a granted modulating load with a power binding
      frees headroom as its measured draw falls (the next pending claim can be
      granted); a clamp going silent mid-grant falls back to the learned
      nominal without a revocation.
- [x] Signed accounting: an import appearing under active grants produces a
      positive deficit and a bottom-up revocation. (Regression guard for the
      clamped-export draft, which could not.)
- [x] A claim on a load already drawing power is granted without waiting for
      headroom it can never show, and `availableSurplusW` is unchanged by the
      grant.
- [x] A revoke the recipe does not honor revokes nobody else: the equipment is
      marked `unresponsive`, its draw counted as background, and the next load
      down keeps its grant.
- [x] `toleratedImportW` widens engage and narrows release by exactly that
      amount, and 0 reproduces the strict behavior.
- [x] `slack: "high"` yields the surplus to a lower-priority claim; no claim
      value can ever move a claim _up_ the user's list.
- [x] Flipping a profiled equipment at the wall (state divergence, no order
      event) revokes and suspends exactly as a manual order does.
- [x] A thermostatic load cycling to zero mid-grant does not drag
      `profile.learned` down, and raises no `watts-divergence`.

## Review log

### Resolved — maintainer review pass, 2026-08-11

1. **API shape** (was open question 1): **callbacks are the contract**;
   `energy.capacity.*` events are observability for the UI and bystanders.
   Rationale: no global-stream filtering in recipes, edge-guarding is
   structural, the arbiter knows exactly who to notify.
2. **Watts trust** (was open question 3 — **revised in the second maintainer
   pass, same day**): measured refinement is **in phase 1**, as a three-tier
   effective-watts rule. The reservation of a granted load uses, in order of
   preference: the load's **smoothed live draw** when it has a fresh `power`
   binding; else a **learned nominal** (rolling estimate from its past runs,
   maintained by the core in the profile); else the declared profile watts
   (first runs, no metering). The claim's `watts` only sizes the _engage_
   decision; once running, the books follow reality. A first pass had
   deferred this to phase 2 on simplicity grounds; the maintainer overrode:
   a modulating load (AC boost 0.8-2.4 kW) with a fixed 2 kW reservation
   strands headroom the next load in the list could use, and both reference
   loads carry dedicated clamps.
3. **Comfort semantics** (was open question 4): convention **plus targeted
   audit** — the arbiter journals `comfort-off-after-revoke` when the claiming
   instance sends an OFF order to a comfort-class equipment right after a
   revocation. No order-countermanding (phase 1 issues no orders).
4. **Defaults** (was open question 5): `releaseHoldS` default raised
   **300 → 600 s**, grounded in a 6-day raw-meter simulation on the reference
   installation (dip-duration distribution below a 600 W load's need: 56 %
   < 5 min, 72 % < 10 min; 600 s cuts pump revocations 5.8 → 3.7/day for
   ~3 c/day of grid; gains flatten beyond 900 s). EMA 60 s, engage 120 s,
   min-on 900 s, min-off 300 s unchanged; all tunable in advanced settings.
5. **Priority** (was open question 6): **single global ordered list**
   confirmed. Per-class rules are re-evaluated with the kVA phase.
6. **Manual override**: TTL 2 h confirmed; the suspension chip and "resume
   control now" action are explicitly in phase 1 UI scope (FR-6).
7. **Claims persistence**: **runtime-only** confirmed; the 2-5 min post-restart
   warm-up is accepted against the stale-state bug class.
8. **Hard quotas above the cheap windows** (12 h filtration vs 8 h HC),
   raised during review: resolved by the "a grant is never required to run"
   principle, author rule 5 (keep the claim open while force-running — a
   grant landing on a running load makes the books exact) and the
   `unclaimed-run` audit signal. See Worked example 2.
9. **Consumer updates and no-PV homes** (maintainer requirement, second
   pass): the implementation plan carries an explicit consumer-recipes step
   (smart-cooling v1.4 with the v1.3 logic as verbatim fallback, tariff
   scheduler #392 with optional claims), released core-first and gated by
   nothing (`sowelVersion` unchanged, optional chaining). Recipes must stay
   fully functional on installations without any production — surplus
   features inert, tariff/comfort value intact (FR-5, author rule 1) — and
   the rollout validates that path on the no-PV demo instance.

### Resolved — contributor review pass, 2026-08-11 (@computingify)

Read against `sowel-recipe-water-heater-smart`, the second published recipe
hand-rolling surplus logic and the harder of the two consumers (worked example
2b). Three of these are defects in the draft, four are additions the load
argues for.

10. **Signed export** (defect, `architecture.md`): the pseudo-code clamped
    `smoothedExportW = max(0, -emaPowerW)`, which erases the magnitude of an
    import — and the import _is_ the deficit. Worked through with the spec's
    own heat-wave numbers: PV 3.2 kW, background 0.9, AC 2.0, pump 0.6 →
    importing 300 W, clamped export 0, `deficitW = 2600 − 2600 = 0`. Turn on
    the 3 kW hob and it is still 0. The release pass was unreachable, and the
    27 test scenarios would have passed over code that never revokes. Fixed:
    the reading stays signed, and `deficitW ≡ signedGridW`. `spec.md` had it
    right; the two documents disagreed.
11. **Already-running claims cannot be granted** (defect): the grant test
    measures free headroom, and a load that is already running has itself
    depressed the export that headroom is computed from. Author rule 5 tells
    hard-quota recipes to hold their claim open while force-running, and
    review decision 8 promises the books become exact "if the grant arrives" —
    but nothing could ever make it arrive, and the test-plan row for it
    described an unreachable state. Fixed by adding the load's own draw to the
    grant test (FR-3): the grant then costs nothing incremental and the
    accounting is exact from that tick on.
12. **Unhonored revokes cascade** (defect): the reservation is freed while the
    consumption stays in the meter, so the next pass sees the same deficit and
    revokes the load below — down the whole list, for one recipe's inaction.
    `revoke-not-honored` being audit-only made this invisible by construction.
    Fixed: the signal now also marks the equipment `unresponsive` for
    `2 × releaseHoldS` (draw counted as background, skipped by the release
    pass). Bounded, still no orders issued.
13. **Tolerated import per claim** (addition, FR-3): the draft can express
    engage margin but not release tolerance, so the release condition is zero
    grid, always. For an all-or-nothing 2.2 kW resistor that is strictly worse
    than what the recipes do today — the water heater's current form lets the
    user accept 200 W of grid to catch a nearly-free heat-up, and dropping
    that would be a regression dressed as a platform improvement.
14. **`slack`, self-demotion only** (addition, FR-3): the rejection of
    recipe-declared priority is right and is exactly what makes its mirror
    safe. Priority is positional — everyone claims the top. Nobody games their
    way _down_. It buys the one thing a static user list structurally cannot
    hold: state of charge, which only the recipe knows.
15. **Per-type min-on / min-off** (addition): the class is derived from
    `EquipmentType` on the grounds that Sowel knows its equipments; the
    timings deserve the same. A blanket 900 s `minOnS` justified by compressor
    short-cycling costs a relay-and-resistor load up to 0.55 kWh of grid per
    unresolvable deficit, for a restart that is free.
16. **Manual override at the wall** (addition, FR-6): order-event detection
    only sees humans who went through Sowel. Water heater contactors and pool
    pump selectors are physical switches; the recipes that drive them already
    ship state-divergence detectors, which is the duplication this spec is
    supposed to end.
17. **Thermostatic loads and the learner** (addition): a load that cycles to
    zero on its own thermostat while still granted must not teach the learner
    its off periods — sample above 25 % of nominal only, or the profile drifts
    down, the arbiter over-grants, and `watts-divergence` blames a correct
    profile.

### Still open — for contributor review

- **Namespace**: `ctx.helpers.energy.claimCapacity()` (namespaced family, this
  draft) vs flat `ctx.helpers.claimCapacity()` — spec 138 chose flat
  (`getTariff`); the namespace bets on a growing family (state, later quota).
  _Contributor position (@computingify): keep the namespace._ Flat was right
  for one read-only getter; this is already two entry points with a lifecycle,
  and the phase-2 quota API lands in the same family. `getTariff` staying flat
  is not an inconsistency worth paying for — it is a helper, not a subsystem.
