# Spec 192 — Plan

## Tasks

- [x] Tracker: `currentForVehicle`, shared vehicle-id helper, evidence change emits
- [x] Route `GET /api/v1/ev-sessions/current`
- [x] UI: client, `liveState`, `EvCurrentSessionCard`, section wiring, i18n FR/EN
- [x] Docs EN/FR, specs index

## Test Plan

| Module                        | Scenario                                         | Expected                                               |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| ev-session-tracker            | open session, Megane reports charging (two cars) | current for Megane, not for Rafale                     |
| ev-session-tracker            | open session, no report (two cars)               | current for none                                       |
| ev-session-tracker            | open session, both cars report charging          | current for none                                       |
| ev-session-tracker            | open session, one car known, no report           | current for it                                         |
| ev-session-tracker            | closed in grace, then grace over                 | current until decided, then empty                      |
| ev-session-tracker            | open session attributed by hand                  | current for that car only; after close, not current    |
| ev-session-tracker            | vehicle report changes evidence                  | `energy.ev_session.updated` emitted                    |
| ev-sessions route             | `current` without `vehicleId`                    | 400                                                    |
| ev-sessions route             | `current?vehicleId=`                             | 200 `{ sessions }` from the tracker                    |
| evSessionsDisplay `liveState` | charger `charging`                               | `charging` with power                                  |
| evSessionsDisplay `liveState` | `connected`, charger `state` false               | `paused`, `charger-off`, since = `vehicle` lastChanged |
| evSessionsDisplay `liveState` | `connected`, on, battery ≥ limit                 | `paused`, `charge-limit`                               |
| evSessionsDisplay `liveState` | `connected`, on, battery < limit or unknown      | `paused`, `waiting-vehicle`                            |
| evSessionsDisplay `liveState` | session ended                                    | `ended`                                                |
| evSessionsDisplay `liveState` | charger missing or no `vehicle` state            | `charging` without power                               |
