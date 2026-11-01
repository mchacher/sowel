# Spec 192 — The charge in progress on the vehicle page

- **Status**: Draft — design agreed with the maintainer on 2026-11-01 (three boards "in progress", "paused", "ended, waiting for attribution" added to the spec 191 design)
- **Date**: 2026-11-01
- **Issue**: #1100
- **Amends**: spec 191 (EV charge sessions and charging cost per vehicle) — FR7, vehicle page

## Context

Spec 191 shows a session on a vehicle's page only once it is attributed, two hours after the unplug (FR3). Before that it is only on the charger's page. On production on 2026-11-01 the Megane was plugged in, had charged, the charger was paused, and its page showed nothing: the maintainer took it for a fault.

## Goal

On the vehicle page, a card for the charge in progress — charging, paused, or ended and waiting for its automatic attribution — on the car Sowel would attribute it to.

## Non-Goals

- No change to the month totals: a session still counts once attributed (spec 191 P7).
- No change to the attribution rule or the grace period.
- No pause reason that the data cannot tell (no guess about the car's own schedule).

## Functional Requirements

### FR1 — Which sessions, on which car

A session is **current** while it is open (plugged in) or closed and still in its grace period. It shows on a vehicle's page when:

- it was attributed to that vehicle by hand while still open (spec 191 FR4); or
- it has no manual choice, and the automatic attribution run now on its evidence (spec 191 `attribute()`) would give that vehicle — one matching car, or the only car Sowel knows.

When no car matches yet, or several do, it shows on no car (it stays on the charger's page). A session closed by hand is no longer current: it is in the month list.

### FR2 — The card

Above the month card, one card per current session, newest first.

| State    | When                                  | Shows                                                                                                                                                                                      |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Charging | open, charger `vehicle` = `charging`  | live power (charger `power`), charger name, start time, kWh and cost so far, off-peak / peak / solar bar                                                                                   |
| Paused   | open, charger `vehicle` = `connected` | "paused since" (when the charger's `vehicle` last changed), start time, the same figures, and a reason                                                                                     |
| Ended    | closed, in its grace period           | start → end, kWh, cost, bar; "will be attributed to <car> around HH:MM" (`graceUntil`); a **That's <car>** button (manual attribution, final) and a link to the charger's page to reassign |

The paused reason, from live data only:

1. the charger's `state` is `false` → "Charger switched off — resumes when it is switched back on (by hand or by a scenario)";
2. else the car's `battery_level` ≥ its `charge_limit` → "Charge limit reached — <car> is at N %, its limit";
3. else → "Waiting for the car — the charger is on, the car is not charging".

A line under the figures of an open session says the month counts it once the car is unplugged and the session attributed. A session shown in the card is not repeated in the month's session list.

### FR3 — Live

The card follows the charger and the car live (their data are already pushed to the page). The session's figures refresh at each 5-minute window, and the card appears as soon as a car report makes the session match: the tracker emits `energy.ev_session.updated` when a vehicle report changes a session's evidence.

### FR4 — API

`GET /api/v1/ev-sessions/current?vehicleId=…` → `{ sessions: EvChargeSession[] }`, the vehicle's current sessions (FR1), newest first. Any role.

## Acceptance Criteria

- [ ] An open session whose evidence matches one car is returned for that car and for no other.
- [ ] An open session with no or several matching cars is returned for none; with a single known car, for it.
- [ ] A closed session in its grace period is returned until it is decided, then no longer.
- [ ] An open session attributed by hand is returned for its car only; a closed one attributed by hand is not.
- [ ] A vehicle report that changes a session's evidence emits `energy.ev_session.updated`.
- [ ] The vehicle page shows the charging, paused (each reason) and ended cards as on the agreed boards, FR and EN.
- [ ] **That's <car>** attributes the session by hand; it then leaves the card for the month list.

## Edge Cases

| Case                                                                   | Behaviour                               |
| ---------------------------------------------------------------------- | --------------------------------------- |
| Charger without a `state` binding                                      | reason 1 never applies                  |
| Car without `charge_limit` or `battery_level`                          | reason 2 never applies                  |
| Charger not loaded in the page's store, or no `vehicle` state          | "Charge in progress" without live power |
| Two current sessions for one car (an ended one in grace and a new one) | two cards, newest first                 |
| No tariff                                                              | cost "—", as in spec 191                |
| Vehicle disabled                                                       | not a candidate (as for `attribute()`)  |

## Docs Delta

- `docs/user/equipments.md` / `.fr.md` — "Charging sessions and cost per vehicle": the card on the vehicle page.
- `docs/technical/api-reference.md` / `.fr.md` — the `current` route.
- `docs/specs-index.md` / `.fr.md` — row 192.
- No screenshot of this section exists yet: none to retake.
