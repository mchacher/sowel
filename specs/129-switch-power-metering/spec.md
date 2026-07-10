# Spec 129 — Metering-aware switch (power/energy on smart plugs)

## Context

Metering smart plugs (e.g. SONOFF **S60ZBTPF** via Zigbee2MQTT) are both a
controllable **on/off switch** and an **energy meter**: they report `power`,
`energy`, `voltage`, `current` alongside the `state` order.

Today a plug modelled as a `switch` equipment **drops its metering**: the
`switch` binding candidate only captures the on/off channel
(`binding-candidates.ts`), the equipment card shows only on/off, and the plug is
excluded from the energy views. Modelling it as `energy_meter` captures the
metering but hides the on/off control. Neither type fits a metering plug.

The Zigbee2MQTT categories are already correct (`power`/`energy`/`voltage`/
`current`) — the gap is in the **core equipment model**, not the plugin.

## Goal

Make the `switch` type **metering-aware and polymorphic**: a basic relay keeps
behaving exactly as today (on/off only), while a metering plug additionally
surfaces its live power, feeds the energy history, and appears in the live
submeter breakdown — all on a single equipment that keeps its on/off control.

## Requirements

1. **Polymorphic binding** — the `switch` auto-binding captures the on/off
   channel **plus**, when the device exposes them, the metering data
   (`power`, `energy`, `voltage`, `current`). A device with no metering data
   binds exactly as today (no regression).
2. **Live power on the card** — a `switch` equipment that has a `power` binding
   shows its instantaneous power (W/kW) on the equipment card, in addition to
   the on/off control. A switch without a power binding shows on/off only.
3. **Energy in history** — a `switch` with an `energy` binding feeds the
   existing energy history/aggregation pipeline (InfluxDB → daily/monthly,
   HP/HC) exactly like an `energy_meter`, via the alias/category-driven path.
4. **Live submeter breakdown** — a metering `switch` (has a `power` binding)
   appears in the live per-equipment consumption donut, alongside
   `energy_meter` submeters.
5. **On/off control preserved** — the metering switch keeps its `state` order
   and its toggle in the UI.
6. **No regression for basic switches** — switches with no metering bindings are
   unchanged in binding, display, energy views, and status.

## Acceptance criteria

- [x] Creating a `switch` equipment on a device that exposes `state` +
      `power`/`energy` auto-suggests a candidate that binds the on/off channel
      **and** the metering data.
- [x] Creating a `switch` on a bare relay (state only) binds on/off only —
      identical to current behaviour.
- [x] The equipment card of a metering switch shows live power (W/kW) + the
      on/off toggle; a basic switch shows only the toggle.
- [x] A metering switch's `energy` binding produces energy history points and
      appears in the energy dashboard (same as an `energy_meter`) — via the
      default-historized `energy` category + alias-driven aggregator.
- [x] A metering switch appears in the live submeter donut; a basic switch does
      not.
- [x] All existing `switch`, energy, and submeter tests still pass (920 pass).

## Scope

**In scope**
- Metering-aware `switch` binding (single on/off channel + shared metering).
- Live power on the switch equipment card.
- Energy history for a switch that reports `energy`.
- Inclusion of metering switches in the live submeter breakdown.
- Power-only metering switches: fold them into the submeter power→energy
  integrator so they also get energy history (a common plug variant that
  reports `power` but not `energy`).

**Out of scope**
- New equipment type (`smart_plug`) — rejected in favour of extending `switch`.
- New `DataCategory` or DB migration.
- **Multi-gang** metering (per-channel `power1`/`power2`): a device with more
  than one on/off channel does **not** auto-attach metering (kept as basic
  per-channel switches; user can bind manually). Documented as a known gap.
- Changes to the Zigbee2MQTT plugin (categories already correct).

## Edge cases

| Case | Expected |
| --- | --- |
| Device with `state` only (bare relay) | Binds on/off only; card shows toggle only; not in energy views. |
| Device with `state` + `power` + `energy` | Binds all; card shows power; energy in history; in submeter donut. |
| Device with `state` + `power` only (no energy) | Binds power; card shows power; integrator derives energy; in donut. |
| Multi-gang plug (`state_l1`, `state_l2`, `power_l1`…) | Per-channel on/off switches; metering NOT auto-attached (out of scope). |
| Metering switch turned OFF (power = 0) | Card shows 0 W; donut slice ~0; no anomaly. |
| Switch with metering but `power` stops updating | Standard spec-116 stale/degraded behaviour on the streaming binding. |
| Existing basic switches after upgrade | Unchanged — no metering bindings created retroactively. |
