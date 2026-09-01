# Spec 174 — A timed action on an actuable equipment

**Issue**: [#874](https://github.com/mchacher/sowel/issues/874)
**Status**: proposed
**Scope**: core (schema, manager, API) — no UI in this phase, see "Out of scope"

## Problem

Nothing in the engine can say **"act now, revert after N minutes"**. Every instance of it is a recipe: `motion-light` (light on, off after the delay), `state-trigger-light`, and `delivery-gate` (gate open, closed after the window). Three copies of the same clock, each with its own persistence, its own restart behaviour and its own cancellation rules — and the rules already differ between them.

The need is not gate-shaped. The same primitive serves a `water_valve` (water for twenty minutes), a `pool_cover`, a `switch` driving an outside plug, a `light_onoff` in a cellar, a `vmc` boosted for a shower. What they have in common is that they are **actuable** and that the user wants a _temporary_ state, not a new resting state.

Raised out of the [#868](https://github.com/mchacher/sowel/pull/868) review, where a recipe tile made it visible: a recipe existed there mostly to hold a deadline.

## Goal

Let an equipment carry **one revert the engine owes it, and when** — persisted, honoured across a restart, and ended by the rules below rather than by whichever recipe happened to implement it.

## Design principle — the engine owns the deadline, the recipe owns the doubt

The action itself is an ordinary order. It goes through `executeOrder` and inherits everything that path already does: per-equipment inversion (spec 154), value resolution against the binding (spec 150), delivery confirmation and its bounded replay (spec 141). **None of that is re-implemented here.**

What is added is the one thing missing: something that remembers, across a restart, that the gate in the yard is open.

What is deliberately _not_ added is the ability to reason about hardware that lies. A gate whose command is a sequential impulse and whose only feedback is a reed contact that cannot be reached unless the gate is against its stop needs a parity re-alignment before it acts, a closing command sent exactly once, and a refusal to arm a window when the gate never moved. That is a property of one installation, not of the `gate` type, and it stays in a recipe. A recipe that only holds a clock should stop existing once this lands; a recipe that carries a genuinely conditional policy keeps its reason to exist and leans on this primitive rather than re-implementing it.

## Functional requirements

**FR-1 — Arm.** `POST /api/v1/equipments/:id/timed-action` with `{ alias, value, revertValue, durationMs }` dispatches `value` now and persists the obligation to dispatch `revertValue` at `now + durationMs`.

**FR-2 — One per equipment.** An equipment carries at most one armed action. `equipment_id` is the table's primary key.

**FR-3 — Persisted, and honoured after an outage.** The deadline is a row, not a `setTimeout`. On boot, a deadline still ahead is re-scheduled on its remainder; a deadline that **passed while the engine was down is fired**, not dropped. That outage is the case the feature exists for.

**FR-4 — A hand-revert disarms.** The mirror binding (the reading carrying the order's own alias, the same rule spec 141 confirms orders with) reporting the revert value while a deadline stands **disarms it and sends nothing**. The state the user just created is the state they asked for; firing later would undo their own hand, and on a toggling command it would re-open the gate they just closed.

**FR-5 — A second arm replaces.** Re-arming the _same_ action on an already-armed equipment moves the deadline and **dispatches nothing**. "Open again", from somebody looking at a gate that is already open, means "give me more time". A _different_ alias or value is a new intent: it is dispatched and it replaces the window. `armedAt` is preserved across an extension — it is one window, not two.

**FR-6 — A failed revert alarms and disarms.** When the revert cannot be dispatched, a `system.alarm.raised` goes out and the row is dropped. The engine has no way to know whether sending it again would put the equipment back or act on it a second time: a dedicated `CLOSE` is a no-op, a sequential impulse re-opens what it just closed. Until an integration can declare which it is, the honest move is to put a human in the loop rather than guess.

**FR-7 — End it early, two ways.** `DELETE …/timed-action` drops the deadline and sends nothing (for a caller who already reverted by hand); `?revert=true` sends the revert now (the "I changed my mind" path).

**FR-8 — Visible in the payload.** `EquipmentWithDetails.timedAction` carries `{ alias, value, revertValue, expiresAt, armedAt, armedBy? }` when a window is running, and is absent otherwise. `expiresAt` is an ISO-8601 instant a UI can tick down.

**FR-9 — Bounds.** `durationMs` is between 10 s and 24 h. Below that this is just an order; above it, "temporary" stops meaning anything for an opening.

**FR-9b — An action and its revert may be the same command (phase 2).** The first draft refused them, reasoning that a deadline sending what is already there makes an invisible window. That is true of a dedicated `ON`/`OFF` pair and false of the hardware this feature exists for: a sliding gate on a sequential impulse is opened and closed by the *same* command, carrying no value at all. The refusal excluded the primary use case, so it is replaced by FR-11.

**FR-10 — Inert in shadow mode.** The manager is created but not started: starting it rehydrates deadlines and can dispatch a revert on the spot, which a shadow instance must never do.

## Phase 2 — the feature reaches the user

Phase 1 gave the engine the deadline and left the surfaces for later, on the grounds that five of
them would each need a countdown. Two of the five carry it (the Dashboard widget and the compact
card), one shared component renders it for both, and the configuration lives on the equipment page.

**FR-11 — Eligibility, and the guard that replaces FR-9's refusal.** A timed command is offered
only on an equipment that carries **the order being armed** and **a state reading tied to it** —
the mirror binding (a reading on the order's own alias), or a reading in an actuator-state category
(`light_state`, `gate_state`, `cover_state`, `lock_state`, `appliance_state`). An impulse gate
qualifies through its `gate_state` contact; a blind relay does not, and on a blind relay FR-4 could
never fire, so the window would run with nobody able to end it early.

Known and accepted: a reed contact only certifies `closed`. A manual close the contact does not see
leaves the deadline standing, and it will re-open the gate. Written down rather than hidden.

**FR-12 — Configured on the equipment, once.** `Equipment.timedCommand` holds
`{ alias, value, revertValue, durationMs }`. Absent means off, which is the default, and is the
same shape `energyProfile` and `solarProfile` already use. The panel on the equipment page has the
form of "Confirmation before action" (spec 146): a checkbox, then the three fields.

One duration per equipment is the deliberate consequence: no "Gate 15 min" and "Gate 2 h" side by
side. Putting the duration in each tile's configuration is what would buy that, and it was weighed
and dropped — the answer belongs with the equipment, like its confirmation guard.

**FR-13 — Armed from the stored configuration.** `POST …/timed-action` with an empty body arms
what `timedCommand` declares. The explicit body of FR-1 still works: a caller that knows what it
wants is not forced through the equipment's configuration.

**FR-14 — Two surfaces, one countdown.** A `timed` flag on a widget's config pins a second tile for
the same equipment, beside the ordinary one. The compact card carries the same command. Both render
the remaining time through **one** shared component; a second copy of that countdown is exactly what
phase 1 refused to write, and the reason it is acceptable now is that there is only one.

**FR-15 — The gestures.** Pressing the timed control while the window is open extends it (FR-5,
nothing dispatched). Cancelling ends the window: from the tile and the card it sends the revert now
(`?revert=true`), which is what somebody looking at an open gate means by "close it".

## Acceptance criteria

1. Arming dispatches the action, persists the revert, and returns the deadline.
2. An action that could not be dispatched persists nothing — a window over an action that never happened is worse than no window.
3. Re-arming the same action extends without dispatching; a different action dispatches and replaces.
4. The deadline dispatches the revert exactly once, with `source = { kind: "external", channel: "timed-action" }`, and forgets the window.
5. The mirror binding reporting the revert value disarms; another alias, another value, or another equipment does not.
6. The engine's own revert is not read back as a hand-revert.
7. A deadline still ahead survives a restart on its remainder; one that passed during the outage fires on the way up.
8. A revert that throws raises exactly one alarm, dispatches nothing further, and leaves no row.
9. Deleting the equipment takes its deadline with it; a row orphaned by a restore is dropped at boot without dispatching.
10. An action and its revert carrying the same value are accepted, so an impulse gate can be armed.
11. An equipment with no state reading tied to the order is refused, with a named error.
12. An empty arm body uses the equipment's stored `timedCommand`; a body still overrides it.
13. The equipment page shows the panel only on an eligible equipment, off by default, and saves the three fields.
14. A `timed` widget renders the countdown while a window is open, extends on a second press, and cancels with a revert.
15. The compact card carries the same control and the same countdown component.

## Out of scope

- **Three of the five surfaces.** `MobileWidgetCard`, `WidgetDetailSheet` and `EquipmentCard` are left alone. Phase 1 refused any UI because five copies of one countdown is how [#744](https://github.com/mchacher/sowel/issues/744) and [#832](https://github.com/mchacher/sowel/issues/832) happened; phase 2 writes the countdown **once**, in a shared component, and wires the two surfaces the feature is actually used from. Spec 149 ([#325](https://github.com/mchacher/sowel/issues/325)) still owns the consolidation of the rest, and it inherits one component rather than two.
- **A declared command idempotence.** FR-6 is a safe default standing in for a fact only the integration knows: whether replaying this command repeats it or undoes it. A `replaySafe` on the order binding would let the engine retry the reverts it can retry and refuse the ones it must not. It is the piece that would close FR-6 properly, and it changes the plugin contract, so it is its own spec.
- **Several actions queued on one equipment**, a timed action on a _reading_ rather than an order, and anything schedule-shaped — that is what recipes are for.
- **The confirmation guard.** A timed action actuates through the ordinary order path, so whatever guard a surface applies to that path applies unchanged. Spec 146 owns it.
