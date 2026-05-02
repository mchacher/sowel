# Spec 086 — Iteration 2: Shelly drives the energy roles

> See [spec 084 — overview](../084-shelly-energy-overview/spec.md) for the
> guiding principles and the full iteration plan.

## Goal

Now that the live power view from iteration 1 has been validated against
Legrand, promote two of the Shelly channels to fill the
`main_energy_meter` and `energy_production_meter` roles, and disable the
Legrand integration. Sowel's existing `EnergyAggregator` keeps doing
HP/HC classification and cumulative aggregation, but reads from Shelly
forward/reverse counters instead of Legrand cumulative readings. The
energy page in Sowel's UI continues to look the same — only the source
changed.

## Key design decisions

- Each `main_energy_meter` / `energy_production_meter` equipment exposes
  two cumulative aliases: `energy_forward` (= imports / production) and
  `energy_reverse` (= exports). The `EnergyAggregator` treats them
  separately for accurate billing.
- Sub-load CT (3rd channel, optional) stays as `energy_meter` —
  informational only, **not summed into the household balance**.
- HP/HC tariff classification remains Sowel-side (timestamp-based) — same
  code as today.

## Out of scope of this iteration

- Independent Influx archive (iteration 3).
- Backfill (iteration 4).
- Per-load self-consumption split.

## To detail later

- Migration path: equipment type change vs. new equipments + retire old?
- How the EnergyAggregator should consume two separate counters
  (forward + reverse) to derive imports, exports, self-consumption, total.
- Validation criteria: 1 month overlap, daily kWh diff < 3%.
- Rollback: re-enable Legrand and demote Shelly to generic if validation
  fails.
