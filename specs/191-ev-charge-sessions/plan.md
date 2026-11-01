# Implementation Plan — Spec 191

## Slices

### Slice A — Accounting and attribution (pure)

- [x] A.1 — Types in `src/shared/types.ts`
- [x] A.2 — `window-accountant.ts` + tests
- [x] A.3 — `attribution.ts` + tests
- [x] A.4 — `driving.ts` + tests
- [x] A.5 — `summary.ts` + tests

### Slice B — Sessions

- [x] B.1 — Migration 038 and `ev-session-store.ts`
- [x] B.2 — `ev-session-tracker.ts` (lifecycle, window settlement, grace, restart, removals, driving) + tests over a real event bus and an in-memory database
- [x] B.3 — Wiring in `src/index.ts`, shutdown

### Slice C — API and live

- [x] C.1 — Routes + tests; attribution PUT on the standard-user allowlist + test
- [x] C.2 — WebSocket: dedup key, UI routing
- [x] C.3 — `plugInHybrid` on equipments (manager, PUT schema)

### Slice D — UI

- [x] D.1 — API client and `useEvSessions`
- [x] D.2 — Vehicle "Home charging" section (variant B) with the plug-in hybrid switch
- [x] D.3 — Charger "Sessions" section and reassignment sheet
- [x] D.4 — i18n FR / EN; pure display helpers + tests

### Slice E — Docs

- [x] E.1 — Docs delta of the spec, EN and FR together; specs index rows

## Test Plan

| Module                 | Scenario                                                                        | Expected                                                |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| window-accountant      | Held power over a whole window, one grid tick                                   | car and import Wh of the window                         |
| window-accountant      | Window with no draw                                                             | Not returned                                            |
| window-accountant      | No charger report for longer than the hold limit                                | Power held 15 min, then nothing                         |
| window-accountant      | Other charger reports keep the held power alive                                 | Integrated over the whole span                          |
| window-accountant      | Charger without power: energy deltas                                            | car = Σ deltas, import null without grid tick           |
| window-accountant      | Charger that reported a power, then a late energy tick                          | Power alone (no double count)                           |
| window-accountant      | Session end mid-window; plug-in mid-window                                      | Partial window over its real length; aligned start      |
| settleWindow           | Car 1.4 kW, import 0.4 kW                                                       | 2/7 grid (P5)                                           |
| settleWindow           | Export the whole window / import above the draw                                 | All solar / all grid                                    |
| settleWindow           | No grid tick, no main meter                                                     | All grid (never invent solar)                           |
| settleWindow           | HC window, HP window, straddling window                                         | HC price, HP price, split by share                      |
| settleWindow           | No tariff                                                                       | Cost null, grid / solar still split                     |
| attribution            | One car plugged and charging, the other unplugged                               | vehicle, single-match                                   |
| attribution            | Battery rising while `charging_state` contradicts (Megane 0.4 case)             | vehicle                                                 |
| attribution            | Both match / none of two                                                        | unattributed, several-matches / no-match                |
| attribution            | Only one vehicle, no report / seen away                                         | vehicle only-vehicle / unattributed                     |
| attribution            | Battery jitter of one point; evidence of a vehicle gone                         | No match; ignored                                       |
| foldReport             | Report made before the start; made during but received 90 min after             | Ignored; counted                                        |
| foldReport             | Away reported after the unplug; open session; no report time                    | Ignored; counted; received time used                    |
| driving                | First reading; measured leg; leg with a rise; leg with charging                 | No leg; km + drop; km only; km only                     |
| driving                | Parked charge between readings; no battery; mileage backwards                   | Next drive measured; km only; ignored, leg kept         |
| summary                | Scaling (meter 10 kWh, estimate 9 kWh, grid 3 kWh); no meter; no estimate       | 3.33 grid / 6.67 solar; energy = estimate; all grid     |
| summary                | whPerBatteryPoint 18 kWh / +30 and 12 kWh / +20, +5 ignored; 10 most recent     | 600 Wh per point                                        |
| summary                | Home 12.21 € / 118.4 kWh, 600 Wh/pt, 300 pts over 1 060 km                      | ≈ 17.0 kWh/100 km, ≈ 1.75 € per 100 km                  |
| summary                | Same consumption and price, twice the km (energy from elsewhere)                | Same € per 100 km (P11)                                 |
| summary                | Plug-in hybrid / no session / not learned / under 50 km                         | Null with the matching reason                           |
| tracker                | connected → charging → connected → charging → disconnected                      | One session                                             |
| tracker                | Session under 100 Wh                                                            | Deleted, `energy.ev_session.deleted`                    |
| tracker                | Meter 1.5 kWh against the window estimate                                       | Energy = meter, shares from the windows                 |
| tracker                | Prices changed mid-session, then afterwards                                     | Each window at its price; closed session unchanged      |
| tracker                | HC window; no main meter and no tariff; aligned grid ticks                      | HC price; all grid, no cost; ignored                    |
| tracker                | Restart still plugged / unplugged meanwhile / plugged at first start            | Continues / closed now / opened                         |
| tracker                | Restart during the grace period                                                 | Decided at grace end from the restored evidence         |
| tracker                | Grace end with one match; late report made during the session                   | Attributed with battery start / end                     |
| tracker                | Both cars match                                                                 | unattributed, several-matches                           |
| tracker                | Manual choice during grace; other; back to attribute; unknown vehicle / session | Final; accepted; accepted; EvSessionError               |
| tracker                | Vehicle removed / charger removed                                               | Sessions keep the name, out of totals / closed and kept |
| tracker                | Learn, then two legs (one charged on the way)                                   | Consumption from the measured leg only; € per 100 km    |
| tracker                | Plug-in hybrid; malformed month                                                 | Reason plug-in-hybrid; null                             |
| tracker                | Charger offline, only computed `energy_hour` events                             | Power held 15 min, never revived                        |
| tracker                | Power-only charger receiving a synthetic `energy` backlog                       | Ignored                                                 |
| tracker                | Restart after an unplug                                                         | Closed at the reading's time (`lastChanged`)            |
| tracker                | The charging car reports its own unplug before the charger                      | Still attributed to it (review finding)                 |
| tracker                | Battery update without a `reported_at` in the same report                       | Received time used, counted                             |
| tracker                | Vehicle removed while a session attributed to it is open                        | `vehicleDeleted` survives the next save                 |
| summary                | Month with an unpriced session                                                  | Home price over priced sessions only                    |
| routes                 | List by charger / by vehicle (default month); neither or both; bad month        | 200; 200; 400; 400                                      |
| routes                 | Summary                                                                         | 200                                                     |
| routes                 | PUT vehicle / other / unattributed                                              | 200, body passed whole (`vehicleId` kept)               |
| routes                 | PUT vehicle without id, other with id, unknown target, empty                    | 400                                                     |
| routes                 | Unknown session / unknown vehicle                                               | 404 / 400                                               |
| auth-middleware        | Standard user PUT attribution; other ev-sessions / equipment PUT                | Allowed; denied                                         |
| evSessionsDisplay (UI) | Month shift across years, month label, bar shares, session chip                 | As expected                                             |

Core scenarios seen failing on broken code: `settleWindow` with `grid = car` instead of `min(car, import)` fails the P5 tests; `attribute` returning the first match fails "both match".

## Validation Plan

- `npm run validate`
- Docs and spec checks (skill, Phase 4)
- Production: two weeks with both cars; compare each automatic attribution with the historised car data (enabled 2026-11-01) and the charging recipe's log.
