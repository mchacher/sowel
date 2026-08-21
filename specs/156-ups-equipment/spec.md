# Spec 156 — UPS (uninterruptible power supply) equipment type

## Context

An inverter/UPS is the one piece of hardware in a home lab that knows, before
anything else does, that the mains just went away. Today Sowel has no way to
model one: the closest fit is a `sensor` equipment, which accepts the battery
percentage and nothing else meaningful, renders a list of anonymous values, and
says nothing about the only question that matters — _am I on mains or on
battery, and how long do I have?_

The data itself is already available on most installations. Network UPS Tools
(NUT) is the de-facto standard: a `upsd` server exposes a flat key/value model
(`ups.status`, `battery.charge`, `battery.runtime`, `ups.load`, `input.voltage`,
…) over TCP 3493, and NAS vendors (Synology DSM, QNAP), Proxmox and most Linux
distributions ship it. A companion integration plugin (`sowel-plugin-nut`)
reads that stream; this spec adds the equipment type it binds to.

## Goals

1. A new `ups` equipment type modelling a UPS as one functional unit: a power
   state, a battery, and a load.
2. Three new data categories — `ups_status`, `battery_runtime`, `ups_load` —
   so the state, the remaining autonomy and the load are first-class values a
   zone card, a chart and a recipe can all read.
3. A read-only equipment surface: type picker, icon, dashboard widget, compact
   zone card, detail page. No orders.
4. Vendor-agnostic: the type describes a UPS, not NUT. A plugin reports only
   the categories its hardware actually exposes, and missing fields are fine.

## Non-Goals

- Sending commands to the UPS (beeper mute, self-test, load-segment shutdown).
  Read-only on purpose: an accidental shutdown order is unrecoverable, and the
  orderly-shutdown chain belongs to `upsmon` on each host, not to a home
  automation engine.
- Modelling the hosts a UPS protects, or their shutdown order.
- Runtime/autonomy prediction beyond what the hardware reports.
- Auto-creating the equipment from the plugin. Like every other type, the user
  creates it and binds a device.

## Functional Requirements

### FR1 — Type and categories

`ups` is a valid `EquipmentType`. Three categories join `DataCategory`:

| Category          | Type     | Unit | Meaning                                      |
| ----------------- | -------- | ---- | -------------------------------------------- |
| `ups_status`      | `enum`   | —    | Where the load is being powered from         |
| `battery_runtime` | `number` | s    | Autonomy remaining at the current load       |
| `ups_load`        | `number` | %    | Output load as a percentage of nominal power |

`ups_status` is a closed enum, resolved by the plugin to exactly one value:

Listed here in the severity order the constant declares, ascending:

| Value         | Meaning                                           |
| ------------- | ------------------------------------------------- |
| `online`      | Running on mains                                  |
| `on_battery`  | Mains lost, running on battery                    |
| `bypass`      | Load on bypass, battery not protecting it         |
| `overload`    | Output load above the unit's rating               |
| `low_battery` | On battery and below the hardware's low threshold |
| `offline`     | Output off / unit not powering the load           |

The values are mutually exclusive and ordered by severity: a UPS reporting
several conditions at once resolves to the most severe. `low_battery` outranks
`overload` and `bypass` because it is the only one that predicts an imminent
loss of the load. This is a deliberate
narrowing of the NUT flag set, which is additive (`OL CHRG`, `OB LB`) and
therefore not directly renderable as one badge. Secondary flags a plugin wants
to keep (charging, discharging, battery-needs-replacing, self-test result) stay
`generic` bindings — visible on the equipment, out of the status enum.

### FR2 — Bindings

`ups` binds whatever telemetry the plugin exposes, as a single "all data"
candidate — the same polymorphic shape as `display` (spec 120) and `sensor`.
Auto-binding accepts:

`ups_status`, `battery_runtime`, `ups_load`, `battery`, `voltage`,
`temperature_device`, `generic`.

No order bindings: the type has no command surface.

### FR3 — The load is reported in percent, never as a metering channel

A UPS reports its load as a percentage of nominal power. Watts can be derived
(`ups.load` × `ups.realpower.nominal`), and a plugin may expose that estimate,
but it MUST NOT carry the `power` category.

Two reasons, and the second is a correctness bug if ignored:

1. It is an estimate with a 1 %-of-nominal granularity — on a 520 VA unit, one
   step is ~5 W. Presenting it beside a real metering channel would imply a
   precision the hardware does not have.
2. Submeter enrolment (#523) is a blocklist, not a whitelist: **any** equipment
   carrying a numeric `power` binding is enrolled as a consumption submeter. A
   UPS would therefore be added to the house consumption breakdown, on top of
   whatever real meter already measures the same circuit — a double count built
   on an estimate.

`ups_load` (percent) is the canonical load category. The watt estimate, when a
plugin exposes it, is a `generic` numeric binding.

### FR4 — A UPS is mains-powered

Plugins MUST declare `powerSource: "mains"` on a UPS device.

The low-battery monitor (spec 143) assumes any device with a `battery` category
and no declared power source runs on a cell, and raises "replace the battery"
when it drops below the threshold. A UPS is precisely the device where that
inference is wrong: its battery discharging is an _event_, not a consumable
running out, and it recharges on its own. Left undeclared, every mains outage
would raise a battery-replacement alarm against the UPS.

Outage alarms are the plugin's job, worded for what actually happened.

### FR5 — UI surface

| Surface           | Content                                                |
| ----------------- | ------------------------------------------------------ |
| Type picker       | `ups` selectable, `BatteryCharging` icon, EN/FR labels |
| Equipment card    | Status badge + battery percentage                      |
| Compact zone card | Status badge + battery percentage                      |
| Dashboard widget  | Status, battery, autonomy, load                        |
| Mobile widget     | Icon + status, tap opens the detail sheet              |
| Detail page       | Every bound value, read-only                           |

The status badge is colour-coded by severity: `online` neutral/ok, `on_battery`
warning, `low_battery` / `overload` / `offline` error, `bypass` warning.

Autonomy is stored in seconds and rendered as a duration ("1 h 05", "12 min").

### FR6 — Freshness

`ups_status`, `battery_runtime`, `ups_load` are streaming categories (spec 116):
a UPS plugin polls, so silence is an anomaly rather than a quiet sensor. Their
staleness window must tolerate a slow poll — UPS telemetry is not worth polling
often, and a 5-minute interval is a reasonable plugin default.

`ups` is NOT a metering equipment type (spec 116's `METERING_EQUIPMENT_TYPES`):
a frozen `voltage` binding on a UPS is not the fault that list is about.

## Acceptance Criteria

1. A `ups` equipment can be created, bound to a device exposing UPS telemetry,
   and appears in its zone, on the dashboard, and on its detail page.
2. A device exposing only a subset of the categories binds and renders without
   error (polymorphism).
3. `ups_status` renders as a severity-coloured badge, localized EN/FR.
4. `battery_runtime` renders as a duration, not a raw second count.
5. A `ups` equipment bound to UPS telemetry — that is, reporting its load as
   `ups_load` per FR3 — is not enrolled as a consumption submeter.

   Note what this does _not_ claim: the core does not block a `power` binding
   on a `ups`. Submeter enrolment is a blocklist and `ups` is deliberately not
   on it, because a smart plug placed upstream of a UPS is a genuine measured
   load that _should_ enrol. FR3 is a plugin contract, kept at the category
   level; this criterion verifies the category actually stays out of the
   energy path.

6. History can be enabled per binding, so battery percentage, load and autonomy
   are chartable.
7. No SQL migration: `equipments.type` is free text.

## Edge Cases

| Case                                           | Expected behaviour                                       |
| ---------------------------------------------- | -------------------------------------------------------- |
| Plugin reports a status outside the enum       | Value stored, badge falls back to a neutral "unknown"    |
| UPS reports no `battery.runtime` (cheap units) | Autonomy row hidden, rest renders                        |
| `upsd` unreachable                             | Plugin flips the device offline; equipment shows offline |
| Several UPS units on one server                | One device each, one equipment each                      |
| UPS discharges to 5 %                          | No "replace battery" alarm (FR4); plugin raises its own  |
