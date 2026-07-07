# Spec 128 — Notification re-notify (repeat)

## Problem

A notification publisher mapping fires only when the mapped value **changes**.
For a value that stays "on" (a State Watch `alarm` boolean, or `alarmSince`
timestamp), you get a single notification and never a reminder. The only
current workaround is to map on a counter (`alarmCount`) that the recipe bumps
periodically — indirect, confusing, and it produces a spurious "reset" ping.

Re-notification is a **notification concern**, not a recipe concern.

## Goal

Add a per-mapping **re-notify** option: while the mapped value stays _active_,
re-send the same notification on a fixed cadence, and stop (silently) when it
becomes inactive.

## Behaviour

- **Active value** (drives the repeat): `true` (boolean), a non-empty string
  that is not `"false"`/`"0"`, a non-zero number, a non-null/non-empty
  timestamp. Inactive: `false`, `0`, `null`, `undefined`, `""`, `"false"`,
  `"0"`.
- **On activation** (value goes inactive → active): send the notification
  (existing throttle path) and start the repeat.
- **While active**: re-send every `repeatMs`, up to the configured maximum.
- **On deactivation** (active → inactive): stop the repeat, reset the counter,
  and send **nothing** (no "resolved" ping). This silent-on-deactivation
  behaviour applies **only to mappings that have re-notify enabled**; mappings
  without re-notify keep the current change-based behaviour unchanged.
- The repeat timer **re-reads the current value on each tick**; if it is no
  longer active it stops without sending (robust against deactivations that
  never reach the change dispatch, e.g. `alarmSince` → `null`).

## Configuration (explicit — no "empty means infinite")

Per mapping, an explicit **re-notification mode**:

| Mode        | Meaning                                         | Extra fields         |
| ----------- | ----------------------------------------------- | -------------------- |
| **None**    | No re-notification (default, current behaviour) | —                    |
| **Forever** | Re-notify every X min while active, no limit    | interval (min)       |
| **Limited** | Re-notify every X min, at most N times          | interval (min) + max |

Distinct from the existing `throttleMs` (which rate-limits rapid change events).

## Scope

**In scope**

- New nullable columns `repeat_ms`, `repeat_max` on `notification_publisher_mappings`.
- Repeat lifecycle in `NotificationPublishService` (timers, activation/
  deactivation, restart recovery, config-change re-sync).
- API: create/update mapping accept `repeatMs` + `repeatMax`.
- UI: explicit re-notify control in the mapping form.

**Out of scope**

- Changing the State Watch recipe (a separate follow-up removes the now-vestigial
  recipe `repeat` param + `alarmCount`/`currentValue`).
- Persisting repeat counters across restarts (counter resets on restart; the
  repeat resumes for values still active).
- Per-channel repeat differences.

## Acceptance criteria

- [x] A mapping with mode **Forever** on a boolean that turns `true` sends one
      notification then a reminder every `repeatMs`; when it turns `false` the
      reminders stop and no extra notification is sent.
- [x] A mapping with mode **Limited (N)** sends the initial notification plus at
      most `N` reminders, then goes silent while the value stays active.
- [x] A mapping with mode **None** behaves exactly as today (no reminders).
- [x] Deactivation via `null` (e.g. `alarmSince` cleared) stops the reminders
      (verified by the timer's per-tick re-check).
- [x] Editing a mapping's re-notify config re-syncs the running timers; deleting
      a mapping cancels its timer.
- [x] `tsc` (backend + UI), `eslint`, `vitest` all pass.
