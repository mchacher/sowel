# Spec 143: Low Battery Alerts

**Status**: Implemented
**Depends on**: spec 116 (device/equipment availability), spec 127/128 (notification channels, repeat), spec 141 (system alarm → notification path)

## Problem

Battery-powered devices (door contacts, motion sensors, remotes, valves) report a
`battery` percentage — or a `battery_low` boolean — and Sowel stores it like any
other device data, then does nothing with it. Nobody watches it. A sensor whose
battery dies simply stops reporting, and spec 116 deliberately classifies the
resulting radio silence as **normal** for event-driven battery hardware
(`SILENCE_EXEMPT_EQUIPMENT_TYPES`, issue #348) — so a dead remote shows `online`
and the failure is invisible until someone notices the automation stopped
working.

The information needed to prevent that is already in the database, hours or days
before the device goes silent. Nothing reads it.

## Goals

1. Watch the battery level of every **battery-powered** device, whatever
   integration produced it, and whether or not the device is bound to an
   equipment.
2. Warn the user when a battery goes below a low threshold: a visible alarm in
   the UI issue banner, a marker on the equipment the device is bound to, **and**
   a push through every configured notification channel.
3. Keep warning — one reminder per week while the battery stays low — so a pile
   that is never replaced does not scroll out of the user's memory after the
   first message.
4. Resolve the alarm by itself once the battery is replaced.

## Non-goals

- No configurable threshold: 20 % is a constant in `constants.ts` (a settings
  key and its UI can come later if a device proves to need a different curve).
- No battery column in the devices list, and no change to the existing battery
  readout of the equipment detail panel (`SensorDataPanel`).
- No battery-level history or trend prediction ("this battery dies in 3 weeks").
- No per-device mute. The existing issue acknowledgement (#424) already hides an
  alarm from the header pill.
- No i18n of alarm text: like every engine alarm today (spec 141), the message is
  English free text. Translating engine alarms is a separate, global concern.

## Functional design

### Which devices are watched

Only **battery-powered** devices. A mains-powered device that happens to publish
a battery-ish key (a backup cell, a router reporting `battery: 0` forever) must
never alarm — a percentage is not proof that a battery is what runs the device.

Sowel does not know a device's power source today: `rawExpose` holds the
Zigbee2MQTT `exposes` array only, and `power_source` is dropped at parse time.
This spec adds it to the discovery contract:

- `Device.powerSource: "battery" | "mains" | "dc" | "unknown"`, filled by the
  integration plugin at discovery.
- The Zigbee2MQTT plugin maps `z2mDevice.power_source` (`Battery`,
  `Mains (single phase)`, `DC Source`, …) onto it — a separate plugin release
  (2.5.0) and the registry bump that spec 089 mandates.
- Every other integration keeps sending nothing → `unknown`.

Watch decision, in order:

| `powerSource`      | Watched?                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `battery`          | yes                                                                                                                 |
| `mains` / `dc`     | no                                                                                                                  |
| `unknown` / absent | fallback heuristic: watched iff the device has **no** mains-metering data (category `power`, `energy` or `current`) |

The fallback is what keeps the feature useful on integrations that will never
report a power source (lora2mqtt, tasmota, …) and on installs running an older
Zigbee2MQTT plugin. `voltage` is deliberately **not** a mains marker: 17 of the
19 battery sensors on the reference install expose their cell voltage under a
`voltage` category, so excluding it would exclude almost every real battery
device.

### Which data is watched

On a watched device, every `device_data` whose `category` is `battery`, plus any
data whose **key** is `battery_low` regardless of its category.

That second clause is not belt-and-braces: on the reference install the ZP01
motion sensors expose `battery_low` with category `generic`, because the
Zigbee2MQTT plugin's own property map has no entry for it (core's
`CATEGORY_BY_KEY` maps it to `battery`, but the plugin's category wins at
discovery). The plugin release fixes the mapping; the key-based clause makes the
core feature correct before and after that release.

Devices with no equipment binding are watched too: a discovered-but-unbound
sensor is exactly the one nobody is looking at.

### When a battery counts as low

| Value shape                                  | Low when         | Recovered when    |
| -------------------------------------------- | ---------------- | ----------------- |
| number, or numeric string, in `[0, 100]`     | `value <= 20`    | `value >= 25`     |
| boolean, or `"true"` / `"false"`             | `value === true` | `value === false` |
| anything else (null, text, out of `[0,100]`) | ignored          | ignored           |

The 5-point hysteresis band (20 low, 25 recovered) exists because battery
percentages of cheap sensors bounce with temperature: a naive `<= 20` /
`> 20` pair alarms and resolves several times a day around the threshold, and
each transition would push a notification.

Values outside `[0, 100]` are ignored on purpose: some integrations report a raw
cell voltage (e.g. `3000` mV) under a key that got categorized `battery`, and
`3000 <= 20` is false but `2.9` V would read as a low percentage. Sowel treats
only a plausible percentage as a percentage; anything else is left alone rather
than guessed.

### Alerting

Crossing into low state:

- persists the alert (device data id, device id, value, raised at, last notified
  at) so a restart neither forgets it nor re-notifies for it;
- emits `system.alarm.raised` with `alarmId = battery-low:<deviceDataId>`, level
  `warning`, `source` = device name, message `Low battery: 12%` (or
  `Low battery` for a boolean sensor).

The alarm reaches the user through two existing paths:

- the UI issue banner and the alarms sheet (spec #424 acknowledgement applies);
- the notification pipeline, which forwards system alarms as a push.

That second path is **broken today** and this spec fixes it: `sendSystemAlarm`
picks "the first enabled Telegram publisher" and drops the alarm entirely when
the user has no Telegram publisher — so a web-push-only install (spec 127) never
received any system alarm, contrary to what spec 141 assumed. It now sends to
**every enabled publisher**, one send per channel, a failing channel logged and
not blocking the others.

### On the equipment

An alarm in the header banner says _a_ battery is low; it does not say which room
to walk to. When the alerting device is bound to an equipment, the equipment
carries the marker too.

`SensorValues` — the compact line shared by the home cards, the dashboard widgets
and the admin equipment cards — already renders a battery indicator when the
level is under 30 % (orange 20-29, red under 20). Two changes:

- it moves **before** the sensor values, so the battery sits to the left of the
  temperature and humidity instead of trailing them;
- it also renders when the equipment's device has an **active low-battery
  alert**, even when the equipment does not bind the battery data itself, and
  even when there is no percentage at all (a `battery_low` boolean sensor). The
  alerting state uses the red alarm styling.

Below 30 % without an alert (21-29 %) the indicator keeps its current
informative orange: a heads-up, not an alarm.

An equipment matches an alert when **any** of its data bindings comes from the
alerting device — the bound key does not have to be the battery one.

### Weekly reminder

While a battery stays low, `system.alarm.raised` is re-emitted for the same
`alarmId` every **7 days**, which re-pushes the notification. The UI keeps a
single entry (the alarms map is keyed by `alarmId`), so the reminder is a
notification, not a duplicated banner line.

The reminder clock is persisted (`last_notified_at`), so restarting Sowel does
not restart the week, and a restart never re-notifies by itself.

### Recovery

When the value comes back at or above 25 % (or the boolean goes false), the
alert row is deleted and `system.alarm.resolved` is emitted — the banner entry
disappears and the user gets a `✅ <device> : Battery back to 87%` confirming the
replacement was seen.

An alert whose device (or device data) no longer exists — device deleted,
integration removed, key renamed — is resolved and deleted at the next sweep.

### Evaluation triggers

1. **On report**: `device.data.updated` for a watched battery data id. Reaction
   is immediate; the battery index (data id → device) is kept in memory and
   refreshed by the sweep, so the hot path costs a `Set` lookup.
2. **Sweep**: 30 s after startup, then every 6 h. The sweep re-reads every
   battery data from SQLite (picking up devices discovered since), evaluates
   them, drives the weekly reminders, and cleans up orphan alerts.

A sweep is required, not an optimization: battery reports are sparse (spec 116
gives them a 2 h freshness window, the longest of all categories), and a device
that already sat below the threshold before this feature existed would otherwise
never be noticed — its next report can be days away.

### Restart behavior

Active alerts are reloaded from SQLite at startup. Nothing is re-emitted: a
client that connects (or reconnects) fetches the active alerts from the new
`GET /api/v1/devices/battery-alerts` route and merges them into its alarm map,
the same way it already rebuilds integration alarms from `/api/v1/health`. That
same fetch feeds the equipment indicator, and is refreshed whenever a
`battery-low:` alarm is raised or resolved over the WebSocket.

### Shadow mode

The monitor is not started in shadow mode (`config.shadowMode`), like the order
confirmation tracker: a shadow instance must not push notifications to the user's
phone.

## Acceptance criteria

- [x] A device data of category `battery` dropping to `<= 20` raises one system
      alarm, and one notification per enabled publisher.
- [x] A `battery_low` boolean turning `true` raises the same alarm without a
      percentage in the message.
- [x] Values in `(20, 25)` neither raise nor resolve — an already-low battery
      stays low, a healthy one stays healthy.
- [x] A battery back at `>= 25` resolves the alarm and sends the recovery
      message.
- [x] While low, the notification repeats every 7 days, and only every 7 days.
- [x] Restarting Sowel does not send a notification for an alert already raised,
      and does not reset its weekly clock.
- [x] A UI client connecting after the alarm was raised still shows it in the
      issue banner.
- [x] A device declared `mains` (or carrying `power`/`energy`/`current` data with
      an unknown power source) raises nothing, whatever its battery value.
- [x] A `battery_low` data categorized `generic` by an older plugin is still
      watched.
- [x] The equipment bound to an alerting device shows the red battery indicator,
      to the left of its temperature/humidity values, including when it binds no
      battery data.
- [x] A system alarm reaches a web-push-only install (no Telegram publisher).
- [x] Out-of-range (`3000`), null and non-numeric battery values raise nothing.
- [x] Deleting the device removes the alert and resolves the alarm.

## Edge cases

| Case                                                                   | Behavior                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Device offline / silent for days with a low value                      | Alarm stays raised — the battery is still low; silence is not recovery.                |
| Device reports 0 %                                                     | Low (0 is a plausible percentage, and a dying cell often reports 0 before silence).    |
| Two battery data on one device                                         | One alert and one alarm per data id; the device name is the same, the messages differ. |
| Battery replaced while Sowel is down                                   | The first report after restart (or the startup sweep) resolves the alarm.              |
| Plugin republishing the same low value repeatedly                      | No new alarm and no new notification — only the weekly reminder.                       |
| Notification publisher disabled                                        | Skipped, like every other notification.                                                |
| Device bound to several equipments                                     | Every one of them shows the indicator; a single alarm and a single notification.       |
| Alerting device bound to no equipment                                  | Banner and notification only — there is no equipment to mark.                          |
| Plugin upgraded and now declares `mains` on a device that had an alert | Next sweep drops the device: alert deleted, alarm resolved.                            |
