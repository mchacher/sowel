# Spec 165 — One load-state model for the arbitration surface

## Problem

The arbitration surface on Energy -> Live is two components stacked in one card:
a roster table giving each flexible load's state right now, and a ribbon giving
the same loads' states over time. They describe the same six situations, and
they were built from two independent models.

- The **roster** is assembled in the browser, in `ArbitrationSurface`, by
  flattening four state-specific arrays of the read model (`grants`, `pending`,
  `suspensions`, `idle`) and re-deciding the displayed state from their fields:
  `stateKey: p.running ? "running" : dormant ? "idle" : "waiting"`.
- The **ribbon** is assembled in the engine, in `buildLoadTimelines`, by
  replaying the decision journal through `sustainedAfter` into
  `ArbiterQuarterState`.

Nothing forces the two to agree, and they no longer do. Spec 164 added
`granted-idle` to the ribbon; the roster does not have it. A water heater
holding a grant while drawing nothing — the exact situation of issue #732 — now
reads as a muted green in the lower half of the card and as a solid "Accordé" in
the upper half, at the same instant, for the same load.

That is the visible symptom. Three more follow from the same cause:

1. **The night state applies to one half only.** `isArbiterDormant` (#577) is
   computed in the UI and rewrites a pending claim into "Au repos" in the
   roster. The ribbon knows nothing about it and paints the current quarter
   yellow "En attente". At midnight the two halves contradict each other.
2. **The vocabulary has drifted.** There are three families of i18n keys for one
   set of states: `arbiter.rosterState.*`, `arbiter.timeline.state.*`,
   `arbiter.legend.*`. The granted state alone has four strings ("Accordé",
   "Accordé", "Accordé (surplus)", "Surplus"); `idle` is "Au repos" in the
   roster and "Éteint" in the ribbon, for the same state. Two colour maps
   (`STATE_COLOR`, `cellColor`) agree by convention only, which is why spec 164
   had to add its 35 % green to just one of them.

## Goal

One canonical load state, resolved in the engine, consumed by both halves of the
surface. The roster stops deciding states and starts rendering them. Adding a
state, a colour or a word becomes a single edit that both halves inherit,
instead of a change that lands in one and is forgotten in the other.

No control change: not one grant, revoke, reservation or journal row differs.
This is a read-model and presentation refactor.

## Requirements

- **FR-1** `ArbiterLoadState` is the single state union, shared by the roster
  and the ribbon: `granted`, `granted-idle`, `pending`, `unmanaged`,
  `suspended`, `idle`. `ArbiterQuarterState` becomes `ArbiterLoadState |
"revoked"` — `revoked` stays ribbon-only, because it describes an event
  inside a time step, not a state a load is in.
- **FR-2** `ArbiterPublicState` gains `loads: ArbiterLoadInfo[]`, one entry per
  declared flexible load, in configured priority order, each carrying its
  resolved `state` plus the figures the roster shows (`watts`, `needW`,
  `toleratedImportW`, `sinceIso`, `reasonWaiting`, `untilIso`). The UI renders
  it as-is and makes no state decision of its own.
- **FR-3** The `granted` / `granted-idle` split of spec 164 is resolved from the
  same `drawState` the ribbon uses, so the two halves cannot disagree. A
  granted load with no fresh measurement is `granted`, as on the ribbon.
- **FR-4** Dormancy moves into the read model as `dormant: boolean`, computed
  from the same inputs as today (run state, daylight, available surplus). Its
  effect on displayed state is applied once, where the state is resolved, and is
  therefore identical in both halves. The ribbon applies it to the current
  quarter only: past quarters are history and are never rewritten.
- **FR-5** One i18n key per state, `arbiter.loadState.<state>`, used by the
  roster pill, the ribbon legend and the cell tooltip. Short legend variants, if
  kept, are suffixed keys of the same root, never independent translations.
- **FR-6** One colour function, `loadStateColor(state)`, replacing `STATE_COLOR`
  and `cellColor`. Fill opacity stays a per-surface concern (a ribbon cell is a
  fill, a pill is a tint), but the hue is decided in one place.
- **FR-7** The four state-specific arrays (`grants`, `pending`, `suspensions`,
  `idle`) stay in `ArbiterPublicState` for one minor version, unchanged, so
  external readers of `GET /api/v1/energy/arbiter/state` (recipes, dashboards)
  do not break. They are marked deprecated in the type and removed in a later
  spec.
- **FR-8** `ui/src/lib/arbitration-lanes.ts` and its test are deleted. It is the
  pre-148 lane builder, referenced by nothing.

## Non-goals

- Any change to how the arbiter decides. Thresholds, holds, priorities,
  reservations and the journal are untouched.
- A `grantedIdleS` metric, deliberately left out of spec 164 for the same reason
  it is left out here: it re-baselines the spec 158 figures.
- **Painting suspensions apart on the ribbon.** They stay folded into
  `idle` / `unmanaged` there, as today; the roster shows "Suspendu" as it
  already does. Splitting them out moves time between the spec 158 metric
  buckets, so it is a decision to take on its own merits, in its own spec.
- Reworking the journal's own vocabulary (`arbiter.kind.*`). Those label
  decisions, not states, and they are already single-sourced.

## Acceptance

- A granted load measured idle for more than five minutes reads the same in the
  roster pill and in the current ribbon cell.
- At night, with the arbiter dormant, a pending claim reads the same in both
  halves.
- Grepping the UI for a state string returns one i18n key and one colour call
  per state.
- No API response loses a field.
