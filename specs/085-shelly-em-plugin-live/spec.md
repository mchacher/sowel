# Spec 085 — Iteration 1: `sowel-plugin-shelly-em` (live power view)

> See [spec 084 — overview](../084-shelly-energy-overview/spec.md) for the
> guiding principles and the full iteration plan.

## Goal

Ship a Sowel integration plugin that subscribes to the Shelly Pro 3EM via
MQTT, exposes one device per CT channel with live `act_power`, voltage,
current, power factor, and the two cumulative counters
(`aenergy.total` / `ret_aenergy.total`). Display a live "production / grid
/ self-consumption" widget in Sowel's UI fed by these channels. Do NOT
touch the energy aggregator or the role of Legrand — both keep running so
we can compare data quality side by side.

## Out of scope of this iteration

- Promoting Shelly channels to `main_energy_meter` / `energy_production_meter` (that is iteration 2).
- Disabling Legrand (iteration 2).
- Long-term archive independent of Sowel (iteration 3).
- Backfill (iteration 4).

## To detail later

- Plugin id and repo name.
- Exact Shelly RPC topic structure (`<base>/em1:0/...` vs `<base>/status/em1:0`).
- Mapping of MQTT topics to data keys (per channel).
- Behavior when only some of the 3 CTs are connected.
- UI widget layout (where the live "production / grid / self-consumption" trio sits).
- Validation criteria for "Shelly matches Legrand within ±2% on power".
