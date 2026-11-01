# Spec 193 — Metered charger and usual vehicle

- **Status**: Implemented — needs agreed with the maintainer on 2026-11-01; production check pending
- **Date**: 2026-11-01
- **Amends**: spec 191 (EV charge sessions), spec 192 (the charge in progress on the vehicle page), spec 182 (EV charger)

## Context

Many home chargers cannot be controlled and report nothing: no plug state, no power. The only way to follow them is to measure their supply line with an energy meter (a current clamp, a DIN-rail meter) that Sowel already reads as a device with `power` and `energy`. The maintainer's installation has one, next to a charger that does report (spec 182), and two cars.

Three things stop Sowel from counting charges on such a charger per car:

1. **It cannot be created.** An `ev_charger` must be a device that publishes the contract's identity categories (`ev_vehicle_state` or `set_ev_charge_current`, `isEvChargerDevice`). A metering channel publishes neither, so the device selector lists nothing.
2. **No session would open.** Spec 191 opens and closes a session on the charger's `vehicle` state (FR1). A metered charger has none.
3. **Two cars charging at once on two chargers stay unattributed.** Each session sees both cars report charging (`several-matches`), so neither is attributed.

## Principles (agreed with the maintainer)

| #   | Principle                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | A charger that only measures its power is a **metered charger**: same sessions, cost and attribution as spec 191, with sessions found from the power.                                                      |
| P2  | Its session starts at the first reading of 500 W or more and ends after 30 minutes in a row under 500 W. Pauses shorter than 30 minutes stay inside the session.                                           |
| P3  | A charger may name a **usual vehicle**. It only breaks a tie: when several cars match a session, the session goes to the usual vehicle if it is one of them. It never attributes a session no car matches. |
| P4  | A car charges on one charger at a time. A car that an overlapping session on another charger gives (by hand, as its single match, or as its usual vehicle) is not a candidate for this one.                |

## Goals

1. Create an `ev_charger` from a device that only meters power and energy.
2. Sessions on it, found from its power (P2), with everything spec 191 and spec 192 give.
3. A usual vehicle per charger (P3), and one charger per car at a time (P4), so two cars charging on two chargers the same night are attributed.

## Non-Goals

- No control of a metered charger: no start/stop, no current, no arbiter claim.
- No change for a charger that reports its vehicle state: P2 does not apply to it.
- No three-phase support beyond what the device measures: a clamp on one phase of a three-phase charger measures a third of it. The docs say so.
- No usual-vehicle fallback when no car matches (a guest's car would be given to it).

## Functional Requirements

### FR1 — Creating a metered charger

- The user creates the charger and picks the energy meter that measures it. The device selector for `ev_charger` lists, after the chargers, the devices with a `power` reading, each marked **metered only** (today they are only reachable through « show all »).
- Bound like any charger: `power` and `energy` take the contract aliases.
- A charger without a `vehicle` binding (by category `ev_vehicle_state`, else alias) is **metered**. The type is unchanged: no new equipment type.
- Energy management stays opt-in (the equipment's energy panel): nothing is enabled on a metered charger unless an admin does it.
- The charger's page and tiles show its power and energy, and no start/stop or vehicle pill: the shared reader already returns `null` for those.

### FR2 — Sessions from the power

For a metered charger only:

- **Open**: the first `power` reading of 500 W or more, with no session open on that charger.
- **Close**: the tracker tick sees no reading of 500 W or more for 30 minutes. `endedAt` is the time of the last reading of 500 W or more, not the time of that tick. The grace period and the attribution window start from that time.
- Energy, windows, cost, minimum 100 Wh and evidence: as spec 191. The car reports received while the power is under 500 W are held: folded at close against `endedAt`, or into the session if it resumes. A car that leaves just after its charge is never seen away during it.
- **Restart**: an open session is kept. Its last active time is now when the current power is 500 W or more, else the time the power binding last changed, never before `startedAt`. That is an approximation (a later change of standby noise moves it), and the held reports are lost. A charger at 500 W or more with no session opens one.

### FR3 — Usual vehicle

- `PUT /api/v1/equipments/:id` accepts `usualVehicleId` (an `electric_vehicle` id, or `null`) on an `ev_charger`. It is admin-only, like the rest of the equipment form. Any other type, or an id that is not a vehicle, gets a 400.
- `attribute(evidence, vehicleIds, usualVehicleId)`: with several matches including the usual vehicle, it gives `{ state: "vehicle", vehicleId: usual, reason: "usual-vehicle" }`. Every other case is unchanged.
- When a vehicle is removed, the chargers that name it lose it.
- **UI**: on the charger's page, for an admin, a **Usual vehicle** select (None + the vehicles), with the hint "Only used when several cars could have charged".
- **Charger list**: the reason reads **usual vehicle**.

### FR4 — One charger per car at a time

When the tracker attributes a session (`decide()`, and `currentForVehicle()` for spec 192), it first drops from the candidates every car given to an **overlapping** session on another charger. That session is open, pending or attributed, and its time range intersects this one. A car counts as given when it is:

- the vehicle of that session, set by hand or decided; or
- for a session not decided yet, the result of `attribute()` on its own evidence and usual vehicle, without this rule. This avoids a cycle.

A car given only as "the only vehicle Sowel knows" counts as given by nobody: that rule rests on no evidence (a guest's car would do the same).

### FR5 — The live card on a metered charger (spec 192)

Without a vehicle state, the card reads the power:

- 500 W or more → **Charging**, with the power;
- under 500 W → **Paused**, with no reason line and no "since".

## Acceptance Criteria

- [ ] (production) An energy meter device (power, energy) can be chosen as a charger and created; its page shows power and energy without controls.
- [x] On a metered charger: power at 500 W or more opens a session. Pauses under 30 minutes stay in it. 30 minutes under 500 W closes it at the last active reading.
- [x] A restart keeps an open metered session and closes it at the right time.
- [x] With both cars charging, the session goes to the charger's usual vehicle (reason `usual-vehicle`); without one, it stays to attribute.
- [x] Car A on a charger that reports its plug state and car B on a metered charger whose usual vehicle is B, the same night, both reporting charging: the metered session goes to B, the other to A.
- [x] A charger with a vehicle state behaves exactly as before.
- [ ] (production) A night charge on a metered charger is attributed to its car, and its energy matches the meter's.

## Edge Cases

| Case                                                           | Behaviour                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A short spike over 500 W (standby, wake-up)                    | opens a session; under 100 Wh it is dropped at close                                                             |
| The car's own schedule starts charging hours after the plug-in | the session starts with the power, not the plug                                                                  |
| A pause over 30 minutes (car waits for off-peak)               | two sessions                                                                                                     |
| Power stops reporting (meter offline)                          | no reading at 500 W or more: closes 30 minutes after the last one; the held power stops at 15 minutes (spec 191) |
| A usual vehicle that is disabled                               | not a candidate, so the tie stays unbroken                                                                       |
| Usual vehicle on a charger with a vehicle state                | allowed: the same tie-break                                                                                      |
| Two overlapping sessions both giving the same car              | each sees the other give it: the car is dropped from both, so neither gets it from P4                            |
| No main meter                                                  | as spec 191: all grid                                                                                            |

## Docs Delta

- `docs/user/equipments.md` / `.fr.md` — EV charger: metered charger (how to create one, single-phase clamp, session rule); charging sessions: usual vehicle and one charger per car.
- `docs/technical/api-reference.md` / `.fr.md` — `usualVehicleId` on `PUT /equipments/:id`; `attributionReason` `usual-vehicle`.
- `docs/technical/data-model.md` and `data-model/equipments.md` (EN only, as for spec 191) — `equipments.usual_vehicle_id`.
- `docs/specs-index.md` / `.fr.md` — row 193.
