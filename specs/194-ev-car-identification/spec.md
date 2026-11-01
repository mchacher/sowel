# Spec 194 — Telling the cars apart from their charge data

- **Status**: Implemented — agreed with the maintainer on 2026-11-01 (generic signals only, no maker-specific logic; the usual vehicle of spec 193 stays optional, empty by default); production check pending
- **Date**: 2026-11-01
- **Amends**: spec 183 (electric vehicle contract: optional `charge_power`), spec 191 (attribution, FR3), spec 193 (usual vehicle becomes the last tie-break)

## Context

Two electric cars, two chargers, and either car on either charger. When both charge at the same time, each session sees both cars report « charging » (their reports reach every open session), and the attribution stays « to attribute » (spec 191 P7). The usual vehicle of spec 193 assumes a charger always serves the same car: wrong for this home. The maintainer wants the cars told apart by what is measured, generically: the core reads only the `electric_vehicle` and `ev_charger` contracts, never a maker's data.

## Principles

| #   | Principle                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Only contract data: the car's `charge_power` (new, optional), `battery_level`, `charging_state`; the charger's `power` and the session's energy. A plugin maps its maker's values onto the contract; the core knows no maker. |
| P2  | A signal decides only when it separates the cars clearly; otherwise the next signal, then the usual vehicle if one is set, then « to attribute » (P7 of spec 191 unchanged).                                                  |
| P3  | A car whose own charging power clearly disagrees with the charger is charging somewhere else: it is not a candidate for that session.                                                                                         |

## Functional Requirements

### FR1 — Contract: `charge_power`

`electric_vehicle` gains an optional data point `charge_power` (category `ev_charge_power`, W): the power the car says it is charging at, from its own report. Optional: a car without it is attributed as before. Bound like the other contract points.

### FR2 — Power signal

While a session is open, each `charge_power` report of a car (above 100 W, timed by the car's `reported_at` like its other reports) is compared with the charger's readings within 2 minutes of it (and the one held at their start). No sample when any of them is under 500 W: a pause, a charge starting or stopping says nothing about where the car charges. It **agrees** when any of those readings is within 30 % or 700 W of the car's power (a ramp, a surplus step, the car's clock), and disagrees when none is. A report repeated with the same time is one sample.

- A car with at least two power samples on a session, fewer than 30 % of them agreeing, **disagrees**: it is no candidate for that session (P3).
- When several cars match a session, exactly one of them agrees (at least one sample, 70 % or more agreeing), and every other one has its own samples and does not agree, it gets the session: reason `power-match`. A car without power data could be the one on this charger: it never loses to one that agrees.
- When this session and another one claim the same car with the same strength (both sure, or both guesses, both automatic), both stay to attribute (it cannot be on both, nothing says which). A choice by hand or a sure claim takes the car from a guess (spec 193 FR4).

### FR3 — Energy signal

When several cars still match and the power signal did not decide: for each matching car with a learned energy per battery point (spec 191; learned only from sessions attributed by hand, as a single match, by power or as the only vehicle — never from a guess or from this signal itself) and a battery rise of at least 2 points on the session, the expected energy is rise × energy per point. If exactly one car's expected energy is within 25 % of the session's energy and every other matching car's is more than 50 % off, it gets the session: reason `energy-match`.

### FR4 — Order

Single match (unchanged) → power → energy → usual vehicle (spec 193) → « to attribute ». Power and energy results count as sure for spec 193's « one charger per car » (they rest on measures, not on a habit).

## Non-Goals

- No maker-specific code in the core. The Renault plugin maps its instantaneous charging power onto `charge_power` in its own repository.
- No signal from the timing of starts and stops (a later spec if the two above are not enough).
- No change to a single match, a manual choice, or a session with one candidate.

## Acceptance Criteria

- [x] Two cars charging at once on two chargers of clearly different power, both reporting `charge_power`: each session goes to its car, `power-match`.
- [x] A car charging elsewhere whose power disagrees with the home charger never gets the home session.
- [x] Two cars charging at once without `charge_power`, each with a learned energy per point: each session goes to its car, `energy-match`.
- [x] Without power or energy data, nothing changes (several matches stay to attribute).
- [ ] (production) Two cars on two chargers the same night are attributed without a usual vehicle.

## Edge Cases

| Case                                                       | Behaviour                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Power ramping at the start or end of a charge              | no sample while the charger reads under 500 W; readings within 2 min absorb a ramp                                  |
| Car reports power after the session closed                 | not sampled (the charger draws nothing then)                                                                        |
| Metered charger paused, or a late report dated in a pause  | not sampled (a reading under 500 W around it)                                                                       |
| Two chargers at the same power, one car reporting no power | not decided by power                                                                                                |
| No energy per point learned yet for a car                  | energy signal skipped for that session                                                                              |
| Both cars fit the energy within 25 %                       | not clear: next signal                                                                                              |
| Restart                                                    | power samples already folded are kept (in the evidence); the charger's power history restarts from its last reading |
| A report received after the session closed                 | not sampled (the charger's history goes with the open session)                                                      |

## Docs Delta

- `docs/technical/data-model/equipments.md` (EN only, as spec 183): `charge_power` row.
- `docs/technical/architecture.md` / `.fr.md`: the two signals in the EV sessions attribution.
- `docs/technical/api-reference.md` / `.fr.md`: reasons `power-match`, `energy-match`.
- `docs/user/equipments.md` / `.fr.md`: how Sowel tells two cars apart; the usual vehicle only for a charger that serves one car.
- `docs/specs-index.md` / `.fr.md`: row 194.
