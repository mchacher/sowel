# Spec 176 — A thermostat's run state has its own alias

## Problem

On a submetered thermostat, the `power` data alias is the wattage read from a clamp. That is the
metering convention: `pickLivePowerW`, the zone power totals and the energy surfaces all look for a
numeric binding under that alias, and spec/PR #548 deliberately bound the PAC's Legrand clamp there.

The alias is unique per equipment (`UNIQUE(equipment_id, alias)`), so the boolean on/off state the
Panasonic device reports about itself no longer had anywhere to live. Every UI surface derived the
thermostat's on/off state as `powerBinding?.value === true`, and `2974 === true` is false. Observed
on production (2026-09-05, logs):

- The thermostat card always showed OFF, with the unit running at 2974 W.
- Every tap on the toggle sent `power: true`, because the toggle always believed it was off: five ON
  orders in 90 seconds from a user trying to control the unit.
- Turning the unit off required a double tap inside the optimistic window, because the card cleared
  ALL optimistic values on any data change, and the clamp pushes a wattage every few seconds.

This is the same root cause as issue #901 (an alias is not a vocabulary: `power` means two things on
a submetered appliance), one layer up. #901 gave the order-confirmation tracker a device-level
mirror; the UI still had no boolean to read.

## Two latent bugs found on the way

Neither had been noticed because existing equipments keep their bindings forever; both bit anyone
binding a thermostat today:

- `RELEVANT_DATA.thermostat` predated the spec 077 category standardization. A freshly bound
  Panasonic thermostat silently lost its `power` (category `power`), `targetTemperature` (category
  `setpoint`) and `outsideTemperature` (category `temperature_outdoor`) data points.
- The global `ORDER_CATEGORY_ALIASES` maps `toggle_power` to `state`, an alias no thermostat surface
  reads. A newly bound thermostat got its power order under `state` and lost the toggle entirely
  (ThermostatCard drives `power`).

## Decision

The device's own boolean power reading binds under a dedicated **`powerState`** alias, on the
`thermostat` type only. `power` stays the wattage. Every thermostat on/off read goes through one
helper with a strict preference order: `powerState` first, a legacy boolean `power` binding as
fallback, never a wattage.

Deliberately NOT generalized to other equipment types. Appliances and media players carry a working
boolean under `power` today; renaming aliases across installs would break user recipes (parameterized
by alias) and InfluxDB history series (keyed by alias) for zero live bug. The clean generic path is a
future spec: a distinct `power_state` data CATEGORY at the plugin level, with alias derivation from
the category, in line with the #839 cleanup. The `powerState` name chosen here stays compatible with
that evolution.

## Companion plugin change

`sowel-plugin-panasonic-cc` 2.3.2: a second on-demand poll 45 s after an order. Comfort Cloud often
still returns the pre-order state at the existing +10 s poll, and the next chance to observe the
effect was the regular 5-minute interval; the UI toggle and the #901 device mirror stayed stale that
long.

## Out of scope

- Any change to the metering convention (`power` = wattage) or to `pickLivePowerW`.
- The generic `power_state` category (future spec, needs a migration).
- The order-confirmation tracker: its #901 device mirror already observes the ordered device's own
  `power` key and needs nothing from this spec.
