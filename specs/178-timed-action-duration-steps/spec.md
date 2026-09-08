# Spec 178 — Pressing again asks for longer, then gives up

**Status**: implemented
**Scope**: db + core (equipments) + UI
**Follows**: [spec 174](../174-equipment-timed-action/spec.md)

## Problem

Spec 174 gave the engine one gesture: **arm**. Pressing the tile again re-arms
the same window, which rule 3 defines as "give me more time" — the deadline
moves out by the SAME configured duration and nothing is dispatched.

That rule answers "not yet" but never "how much longer". On the reference
installation the gate is configured at 15 minutes, and the person standing in
front of it wants a vocabulary of three answers, not one: a quarter of an hour
for a delivery, half an hour for a visitor, an hour for a move. Today the only
way to get an hour is to press four times, and each press asks the same
question — the tile cannot say what the next press will do, because every press
does the same thing.

The other half is missing too. There is a **cancel** button on the tile, and it
sends the revert: it closes the gate. There is no gesture for "keep it open, and
stop counting" — the case where the deadline itself is what the person no longer
wants. `DELETE ?revert=false` exists in the API and no surface reaches it.

## Design principle — one control, an announced sequence

A press is cheap and a mistake is not, so the sequence must be **declared, not
discovered**: the equipment carries the ladder of durations it offers, the
control names what the next press will do, and the last rung is the way out.

The ladder belongs to the equipment rather than to the tile because two surfaces
already render this control (the tile and the compact row). A ladder held by a
surface is a second copy of the policy, which is how #744 and #832 happened.

## Goal

Let an equipment declare a ladder of window lengths, so that pressing its timed
control walks up the ladder and, past the top, gives the deadline up.

## In scope

- `TimedCommand.durationStepsMs?: number[]` — the ladder, shortest first.
- Arming walks it: first press acts and arms rung 1, each further press moves
  the deadline to `now + rung(n+1)` and dispatches nothing, and a press past the
  top rung **disarms without reverting**.
- `timed_actions.step_index` — which rung the standing window is on.
- The API answers what the press did, so a surface never has to guess.
- The tile names what the next press does, and says when a press stopped the
  countdown rather than snapping back to its resting face.
- Configuration UI for the ladder on the equipment page.

## Out of scope

- **Changing the default.** An equipment with no ladder keeps spec 174 rule 3
  exactly: a second press extends by the configured duration. Every existing
  installation is untouched.
- **The cancel button.** It still sends the revert — "close it now" is a
  different intent from "stop counting", and both deserve to exist.
- **A ladder per surface, or a ladder the user edits at press time.** The
  equipment declares it; the control walks it.
- **Descending the ladder.** A press only ever asks for more, then gives up.
  Going back down is what cancel-then-arm already does.
- **The compact row** (`TimedCommandControl`). Its button already turns into a
  cancel while a window runs — spec 174 put the extend gesture on the tile
  alone, "where a press is deliberate enough to mean more time" — so there is
  no press there to walk a ladder with. Changing that is a decision about the
  row, not about the ladder.

## Functional rules

1. **FR-1 — The ladder is declared.** `durationStepsMs` is an optional array on
   `TimedCommand`: 2 to 6 entries, strictly increasing, each within the spec 174
   bounds (10 s … 24 h). When present, `durationMs` is kept equal to its first
   entry, so every surface reading `durationMs` today keeps showing the length
   of the first press.

2. **FR-2 — The first press is unchanged.** It dispatches the action and arms
   rung 1. Identical to spec 174, ladder or not.

3. **FR-3 — A further press climbs.** With a window standing on rung _n_, the
   next press moves the deadline to `now + rung(n+1)` and **dispatches
   nothing** — spec 174 rule 3 holds, only the length changes. `armedAt`
   survives: it is still one window.
   The new deadline is counted from **now**, not from `armedAt`: the person
   pressing is answering "how much longer from here", and a rung shorter than
   the time already elapsed would otherwise fire immediately.

4. **FR-4 — Past the top rung, the deadline is given up.** The window is
   disarmed and **nothing is dispatched**: the gate stays where it is. This is
   the "keep it open, stop counting" gesture, and it is deliberately NOT the
   cancel button, which reverts.

5. **FR-5 — The press says what it did.** Arming answers with the standing
   window plus the rung it is on and the length of the next press, or with an
   explicit "given up" when FR-4 fired. A surface renders the answer; it does
   not recompute the ladder.

6. **FR-6 — A changed ladder does not strand a window.** If the configuration
   changed under a standing window, the stored rung is resolved against the new
   ladder by length (the nearest rung not shorter than the current window);
   past the end, the next press gives up as in FR-4.

## Acceptance criteria

- [x] An equipment can be given, and cleared of, a `durationStepsMs` ladder
      through `PUT /api/v1/equipments/:id`; a non-increasing, too short, too
      long or out-of-bounds ladder is refused with 400.
- [x] First press on a laddered equipment: the action is dispatched and the
      window is rung 1.
- [x] Second and third press: nothing is dispatched, the deadline becomes
      `now + rung(n+1)`, `armedAt` is unchanged.
- [x] Press past the top rung: the window is gone, nothing was dispatched, and
      the equipment did not move.
- [x] An equipment with no ladder behaves exactly as it does today (extend by
      the configured duration, indefinitely).
- [x] The response names the current rung and the next press's length.
- [x] A window armed on a rung that no longer exists resolves per FR-6 rather
      than throwing.
- [x] The deadline still fires the revert at its end, on any rung.

## Edge cases

| Case                                                           | Behaviour                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Ladder configured with a single entry                          | Refused (400): a ladder of one is `durationMs`, and pressing again would give up instantly — a foot-gun on a gate. |
| Window on the top rung, engine restarts                        | The rung is persisted, so the next press still gives up rather than restarting the climb.                          |
| Ladder cleared while a window stands                           | The window keeps running on its own deadline; the next press extends per spec 174 rule 3.                          |
| Hand-revert (spec 174 rule 2) on any rung                      | Disarms, as today. The ladder changes nothing about how a window ends early.                                       |
| Press past the top on an equipment whose revert already failed | There is no window to give up; the press arms a fresh rung 1.                                                      |
| Two surfaces pressing at once                                  | Last write wins on the row, as today; the rung is read and written in the same statement path.                     |
