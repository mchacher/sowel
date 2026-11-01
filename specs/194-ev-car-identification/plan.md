# Spec 194 — Plan

## Tasks

- [x] Contract `charge_power` (types, constants, binding list, i18n)
- [x] `foldPower`, agreement rules, `attribute` power and energy tie-breaks
- [x] Tracker: charger power log, car power sampling, energy per point in `resolve`/`givenBy`
- [x] Docs EN/FR, specs index

## Test Plan

| Module             | Scenario                                                           | Expected                           |
| ------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| attribution        | `foldPower` within 30 % / 700 W, and outside                       | agreeing counted / not             |
| attribution        | two matching cars, one agreeing on power                           | `power-match`                      |
| attribution        | a car with two disagreeing samples                                 | not a match                        |
| attribution        | two matching cars, one fitting the energy, the other far           | `energy-match`                     |
| attribution        | both fitting the energy                                            | several matches (or usual vehicle) |
| ev-session-tracker | two cars at once on 1.3 kW and 7 kW chargers, both reporting power | each its car, `power-match`        |
| ev-session-tracker | a car charging elsewhere at 11 kW during a guest's 3 kW session    | not attributed to it               |
| ev-session-tracker | two cars at once, no power, learned energy per point               | each its car, `energy-match`       |
| ev-session-tracker | two cars at once, no data                                          | several matches (unchanged)        |
