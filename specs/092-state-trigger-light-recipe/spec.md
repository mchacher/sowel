# Spec 092 — State-triggered light recipe

## Summary

A new external recipe plugin `state-trigger-light` that turns lights on
for a fixed duration when a watched equipment's `state` alias changes
to a configured target value. Typical use cases: "turn on the driveway
lights for 5 minutes when the gate opens at night", "turn on the
hallway light when the garage door opens after sunset". Optionally
restricted to nighttime only.

## Why

Today motion-based automation requires a PIR sensor. Many practical
triggers in the home are not motion but **state transitions** of
existing equipments — a gate opening, a garage door opening, a contact
sensor closing. Sowel already aggregates day/night via the sunlight
manager, and the gate/appliance/contact equipments expose `state`. A
small recipe ties the two together without needing extra hardware.

## Scope

In:

- New external plugin repo `sowel-recipe-state-trigger-light` distributed
  via GitHub releases, registered in `plugins/registry.json`.
- Recipe definition with the slots described below.
- Subscribes to `equipment.data.changed` for the watched equipment.
- Fires when `alias === "state"` AND `value === stateValue` AND
  `previous !== value` (i.e. it's a transition into the target value,
  not a stable repeat).
- If `nightOnly` is on, checks `zone.aggregatedData.isDaylight` for the
  root zone — skips when daytime.
- If lights are already ON at the moment the trigger fires, the recipe
  does **nothing** (manual override is respected).
- Otherwise turns lights ON and arms a fixed timer; on timer expiry
  turns them OFF.

Out:

- No "from → to" transitions — only the target value matters.
  Entering the target value from any previous value triggers.
- No timer extension on re-trigger. If the watched state re-enters the
  target value while the timer is running, nothing happens (lights are
  already on, timer keeps its original deadline).
- No brightness control. State `ON` only — for dimmable use cases the
  user can wire in `motion-light-dimmable` or wait for a future
  `state-trigger-light-dimmable` variant.
- No tariff/HP-HC awareness — irrelevant here.
- No daytime-only or "any time" mode in v1 — just the nightOnly toggle.
- No support for state aliases that are not `state` (e.g. firing on
  `temperature` crossing a threshold). That's a separate "rule" feature.

## Slots

| id         | type        | required | default | constraint / notes                                                      |
| ---------- | ----------- | -------- | ------- | ----------------------------------------------------------------------- |
| zone       | zone        | yes      | —       | Where the lights live; the watched equipment can be in another zone     |
| trigger    | equipment   | yes      | —       | Equipment whose `state` alias is watched. Filtered to those exposing it |
| stateValue | text        | yes      | —       | Exact target value (e.g. `open`, `ON`, `true`, `closed`)                |
| lights     | equipment[] | yes      | —       | Lights to turn on. Constraint: equipmentType `light_onoff`              |
| duration   | duration    | yes      | "5m"    | How long the lights stay on after a trigger                             |
| nightOnly  | boolean     | no       | true    | When true, only fire when daylight=false at the root zone               |

## Acceptance criteria

- [x] New repo `mchacher/sowel-recipe-state-trigger-light` with the same
      build / release pattern as the other recipe plugins (tsc to dist,
      GitHub Actions tarball, manifest.json, package.json).
- [x] Plugin id `state-trigger-light`, type `recipe`.
- [x] Equipment selector for `trigger` filtered to equipments exposing a
      `state` data binding.
- [x] On state-change event matching `stateValue`, light turns ON for
      `duration`, then OFF.
- [x] When `nightOnly` is on and daylight is true, the trigger event is
      ignored.
- [x] When the lights are already ON at trigger time, recipe leaves them
      alone (no timer armed, no off later).
- [x] When the lights are turned off externally during the timer, the
      recipe cancels its pending off.
- [x] State persisted across Sowel restart: a timer in flight at restart
      resumes with its remaining duration if `expiresAt` is still in the
      future, or fires immediately if past.
- [x] Added to `plugins/registry.json`.
- [x] Tests cover: trigger fires on transition, ignored when same value
      repeats, ignored in daytime when nightOnly, ignored when lights
      already on, timer fires off, restart resumes timer, manual off
      cancels.

## Edge cases

- The watched equipment is offline: events stop arriving, the recipe
  simply waits. If the timer is running, it continues normally.
- The target stateValue does not match any value the equipment ever
  reports (typo): the recipe never fires; logged at debug for dev
  troubleshooting but no user-facing alarm.
- The `trigger` equipment is the same as one of the `lights` (silly
  config but possible): the recipe can't both watch and drive — we add
  a validate() check that rejects this.
- The lights array contains a non-existent equipment id: skipped at run
  time, logged at warn.
- Multiple state changes in rapid succession (e.g. gate flapping):
  first change arms the timer, subsequent changes within the timer
  window are no-ops.
- Sunlight not configured (root zone has `isDaylight === null`): treat
  as nighttime so the recipe still fires (better safe than silent).
