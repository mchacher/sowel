# Spec 143 — Implementation plan

Branch: `feat/low-battery-alerts`

## Steps

1. **Types & constants** — `PowerSource`, `Device.powerSource`, `BatteryAlert` in
   `types.ts`; thresholds, hysteresis, intervals and `MAINS_DATA_CATEGORIES` in
   `constants.ts`.
2. **Migration** — `migrations/017_battery_alerts.sql` (column + table).
3. **Device manager** — accept `powerSource` in `DiscoveredDevice`, persist it,
   return it from `rowToDevice` (default `unknown`).
4. **Monitor** — `src/devices/battery-monitor.ts`: `isBatteryPowered` and
   `classifyBattery` pure functions, alert store (load / upsert / delete),
   `device.data.updated` handler, sweep timer, alarm emission.
5. **Tests** — `src/devices/battery-monitor.test.ts` (see test plan below).
6. **Notification broadcast** — `sendSystemAlarm` sends to every enabled
   publisher; tests in `notification-publish-service.test.ts`.
7. **API** — `GET /api/v1/devices/battery-alerts`, registered before the `:id`
   route; wire the monitor through `server.ts`.
8. **Wiring** — instantiate in `src/index.ts`, `init()` unless
   `config.shadowMode`, `destroy()` on shutdown alongside the other trackers.
9. **UI** — `batteryAlerts` slice in `useWebSocket` (restore on connect, refetch
   on `battery-low:` alarms), `batteryAlert` in `useEquipmentState`, indicator
   moved first + alert state in `SensorValues`, prop threaded through the four
   call sites.
10. **Docs** — data model, API reference, plugin development contract, specs
    index.
11. **Screenshots** — local dev instance with a seeded low-battery device:
    header issue pill, alarms sheet, and an equipment card showing the indicator
    left of its temperature/humidity. Saved under `screenshots/`, linked from the
    PR.
12. **Companion plugin PR** — `sowel-plugin-zigbee2mqtt` 2.5.0 (`power_source`
    mapping + `battery_low` category), then the registry sha256 bump PR in core
    (spec 089). Separate branches, separate PRs, neither merged by us.

## Screenshots

Taken on a local dev instance seeded with four devices (`screenshots/`):

| File                             | What it shows                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `header-pill.png`                | The header issue pill counting the two low batteries                              |
| `alarms-sheet.png`               | Both alerts in the alarms sheet: a percentage one and a `battery_low` flag one    |
| `equipment-percentage.png`       | Garage sensor: red `12 %` left of humidity and temperature                        |
| `equipment-battery-low-flag.png` | WC detector: the marker on an equipment that binds no battery data, no percentage |
| `equipment-healthy.png`          | Cave sensor at 96 %: no marker at all                                             |
| `equipments-list.png`            | The admin equipments list, same markers, mains-fed plug untouched                 |

## Test Plan

### Modules to test

- `src/devices/battery-monitor.ts` — device eligibility, classification, alarm
  lifecycle, persistence, reminder cadence, sweep reconciliation.
- `src/notifications/notification-publish-service.ts` — system alarm broadcast.
- `ui/src/components/equipments/SensorValues.tsx` — no React test in this project;
  covered by manual verification and screenshots.

### Scenarios

| Module                       | Scenario                                                     | Expected                                                                  |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| battery-monitor              | `powerSource: "battery"`, numeric 12                         | `system.alarm.raised` once, alarmId `battery-low:<dataId>`, row persisted |
| battery-monitor              | `powerSource: "mains"`, numeric 12                           | ignored — no alarm, no row                                                |
| battery-monitor              | `powerSource: "unknown"` + `power`/`energy` data, numeric 12 | ignored (heuristic says mains-fed)                                        |
| battery-monitor              | `powerSource: "unknown"` + `voltage` data only, numeric 12   | alarm raised — cell voltage is not a mains marker                         |
| battery-monitor              | `battery_low` key with category `generic`, `true`            | watched, alarm raised                                                     |
| battery-monitor              | numeric 12 reported again while already low                  | no second raise, `lastNotifiedAt` unchanged                               |
| battery-monitor              | `battery_low` boolean `true`                                 | alarm raised, message without a percentage                                |
| battery-monitor              | `battery_low` boolean back to `false`                        | `system.alarm.resolved`, row deleted                                      |
| battery-monitor              | 22 % while low (inside the hysteresis band)                  | stays low, no resolve                                                     |
| battery-monitor              | 22 % while healthy                                           | stays healthy, no raise                                                   |
| battery-monitor              | 30 % after being low                                         | resolved, row deleted, recovery message names the value                   |
| battery-monitor              | value `3000`, `null`, `"unknown"`, `-1`                      | ignored — no alarm, no row                                                |
| battery-monitor              | data of another category (`temperature`) at 12               | ignored                                                                   |
| battery-monitor              | sweep, alert older than 7 days                               | `system.alarm.raised` re-emitted, `lastNotifiedAt` stamped                |
| battery-monitor              | sweep, alert notified 2 days ago                             | no re-emission                                                            |
| battery-monitor              | restart with a persisted alert, battery still low            | alert restored, nothing emitted, weekly clock preserved                   |
| battery-monitor              | restart with a persisted alert, battery replaced meanwhile   | startup sweep resolves it                                                 |
| battery-monitor              | sweep, alert whose device data no longer exists              | resolved and deleted                                                      |
| battery-monitor              | sweep discovers a device already below the threshold         | alarm raised                                                              |
| battery-monitor              | `destroy()`                                                  | timer cleared, unsubscribed, no further emission                          |
| notification-publish-service | system alarm, telegram + web-push publishers enabled         | both channels receive the message                                         |
| notification-publish-service | system alarm, only web-push configured                       | web-push receives it (today: nothing)                                     |
| notification-publish-service | system alarm, one publisher disabled                         | disabled publisher skipped                                                |
| notification-publish-service | system alarm, telegram send rejects                          | error logged, web-push still sent                                         |

### Manual verification

- Seed a device data `battery = 12` on a local dev instance → banner shows the
  issue, alarms sheet lists it, screenshots taken.
- The equipment bound to that device shows the red battery indicator to the left
  of its temperature/humidity, on the home card and on the admin card.
- An equipment bound to the same device but **not** to its battery data shows the
  indicator too.
- Set the same data to `40` → banner and equipment indicator clear without a
  reload.
- Reload the page while the alarm is active → the issue and the indicator are
  still there (route restore path).
