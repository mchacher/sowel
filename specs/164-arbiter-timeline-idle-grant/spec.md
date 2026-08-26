# Spec 164 — Granted-but-idle on the arbiter timeline

## Problem

The arbiter timeline paints one green for every quarter a load held a grant.
That green says "the surplus was allocated to this load". It does not say
whether the load did anything with it.

The two cases look identical today:

- the pool pump was granted 600 W and drew 600 W — the surplus was self-consumed;
- the water heater was granted 2 200 W and drew nothing — the surplus was
  allocated, reserved against other loads, and exported anyway.

The second case is not hypothetical: it is what issue #732 surfaced on the
reference installation, where a water heater sat off for a week while the
timeline showed an unbroken green ribbon. The household cannot tell, from the
surface built to answer exactly that question, that a grant produced nothing.

## Goal

On the per-load ribbon, a quarter where the load held a grant **and was
measured drawing** keeps the current green. A quarter where it held a grant and
was **measured idle** gets a muted variant of the same green: same family, so it
still reads as "accordé", visibly different, so an unproductive grant is
readable at a glance.

## Requirements

- **FR-1** The arbiter observes, per granted load, whether its own power
  measurement is above or below the idle threshold, and journals a transition
  when that observation **holds for 5 minutes** (`DRAW_CONFIRM_MS`). Two new
  decision kinds carry it: `draw-stopped` (granted, measured idle) and
  `draw-started` (granted, measured drawing again).
- **FR-2** The evidence is the load's **own measurement only**. A load with no
  fresh power reading produces no transition and keeps the current green — the
  surface never claims knowledge it does not have. The reported on/off state is
  explicitly NOT used here: it lies on an inertial load (#631, review #733).
- **FR-3** A grant starts optimistic: `granted` paints the drawing green, and
  only a sustained measured idle flips it. A load that never starts flips once,
  5 minutes in.
- **FR-4** The timeline gains one quarter state, `granted-idle`, rendered as
  `--color-solar-auto` at 35 % over the surface, with its own legend entry and
  its own cell tooltip label, in French and English.
- **FR-5** A measurement going stale mid-grant holds the current state rather
  than flipping it: absence of data is not evidence of idleness.
- **FR-6** Losing the grant (revoked, released, suspended, disabled, restart)
  ends the observation and clears its state. The existing states win the
  quarter exactly as they do today — in particular a quarter containing a
  revoke stays red.
- **FR-7** Spec 158 metrics are unchanged: `granted-idle` time still counts as
  granted time in `grantedS`. The two new kinds count as neither grants nor
  revocations.

## Acceptance criteria

- [x] AC1 — A granted metered load whose draw stays below the idle threshold for
      5 minutes journals one `draw-stopped`, and its ribbon quarters turn muted
      green from there.
- [x] AC2 — The same load drawing again journals one `draw-started` and the
      ribbon returns to the full green.
- [x] AC3 — A dip shorter than 5 minutes journals nothing and leaves the ribbon
      unchanged.
- [x] AC4 — A granted load with no power binding never journals either kind and
      keeps the current green for the whole grant.
- [x] AC5 — A load whose measurement goes stale keeps the state it had.
- [x] AC6 — A revoke inside a quarter still paints that quarter red, whatever the
      draw state entering it.
- [x] AC7 — `grantedS` in the daily metrics is identical with and without the
      new kinds; `grants` and `revokes` counters are untouched.
- [x] AC8 — The legend shows the new entry, and both locales carry the new kind
      and state labels (locale-completeness test green).

## Scope

**In scope**

- Draw observation on granted loads in `capacity-arbiter.ts`, with the 5-minute
  confirmation, journaled through the existing decision journal.
- Two new `ArbiterDecisionKind` values and one new `ArbiterQuarterState`.
- Timeline reconstruction, ribbon colour, tooltip, legend, journal dot + label.
- Metrics neutrality.

**Out of scope**

- A `grantedIdleS` metric (a new column in `arbiter_daily_load_metrics` and a
  rollup change). Worth having, and a separate piece of work — this spec keeps
  the spec 158 baseline strictly comparable.
- Any change to the live roster table above the timeline: it already shows the
  live watts of each load, and the request is about the ribbon.
- Any control behaviour. The arbiter grants, revokes and reserves exactly as it
  does today; this is observation only.
- Inferring consumption for unmetered loads from anything other than a power
  measurement.

## Edge cases

| Case                                   | Behaviour                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Load with no power binding             | No transition ever journaled; ribbon keeps the current green (FR-2)              |
| Measurement goes stale mid-grant       | State held, no flip (FR-5)                                                       |
| Thermostatic load cycling below 5 min  | Nothing journaled — the confirmation window absorbs it                           |
| Load idle at grant, starts at 3 min    | Nothing journaled (the idle never reached 5 min); ribbon stays green             |
| Grant lost while idle                  | Observation cleared; no `draw-started` on the next grant until it actually draws |
| Restart during an idle grant           | `reset` closes the span (#604); a fresh `draw-stopped` is journaled 5 min later  |
| Load deleted / profile dropped         | Per-equipment state dropped with the rest in `forgetEquipment`                   |
| Legacy journal rows (before this spec) | No new kinds present; every granted quarter reads as it does today               |
