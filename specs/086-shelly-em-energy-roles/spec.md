# Spec 086 — Iteration 2: Shelly drives the energy roles

> See [spec 084 — overview](../084-shelly-energy-overview/spec.md) for the
> guiding principles and the full iteration plan.

## Goal

Plug the Shelly Pro 3EM channels into Sowel's existing `EnergyAggregator`
so the **Consumption / Production** pages show kWh figures derived from
Shelly's per-channel forward/reverse counters, with the same HP/HC tariff
classification as before. The Live page (iteration 1) keeps working
unchanged.

After this iteration, Legrand is fully retired (already done in IT 085
during the migration session) and the Sowel-internal Influx contains a
continuous energy history fed entirely by Shelly.

## In scope

- Shelly plugin (`sowel-plugin-shelly-mqtt`) v1.1.0:
  - Synthesise a signed `energy` delta alias on each `em1data:N` update,
    computed as `(forward_t − forward_{t-1}) − (reverse_t − reverse_{t-1})`.
  - Track the last cumulative `total_act_energy` /
    `total_act_ret_energy` per channel using the existing `device_data`
    SQLite as the persistent baseline (no new on-disk state file).
  - Reset detection: when the current cumulative reading is lower than
    the persisted baseline (Shelly factory reset, firmware reset, or
    out-of-order delivery), emit `energy = 0` and refresh the baseline
    to the current value.
  - Keep emitting `power`, `energy_forward`, `energy_reverse` as today
    — they remain useful for the Live page and future scenarios.
- Equipment bindings on `Shelly Grid` (main_energy_meter) and
  `Shelly Solar` (energy_production_meter):
  - `power` (already there)
  - `energy_forward`
  - `energy_reverse`
  - `energy` — required for the aggregator trigger
- Plugin registry update (`plugins/registry.json`) bumping
  `shelly_mqtt` to 1.1.0.

## Out of scope

- Computed/derived metrics for scenarios (rolling averages, "solar
  excess available", etc.). Tracked separately, future spec.
- Backfill of Sowel-internal Influx with historical Shelly data
  (n/a — IT 085 already migrated Legrand history to the new equipment
  ids).
- The independent `energydata-stack` (Telegraf / dedicated Influx /
  Grafana) — that is iteration 087.
- Changes to `EnergyAggregator` itself. The current trigger
  (`alias === "energy"`) is preserved; only the source changes.
- Per-load self-consumption split. The 3rd CT (em2) stays as a
  discovered device with no equipment until the user clamps a sub-load.

## Acceptance criteria

- [ ] Plugin v1.1.0 emits an `energy` value (signed Wh delta) alongside
      `power`, `energy_forward`, `energy_reverse` on each em1:N device.
- [ ] Plugin restart leaves no spurious delta: first event after
      restart uses the persisted cumul as baseline (or emits 0 if cumul
      was lower).
- [ ] `Shelly Grid` and `Shelly Solar` equipments are bound to the new
      `energy` alias and start producing `equipment.data.changed`
      events with `alias === "energy"`.
- [ ] `EnergyAggregator` picks up the new equipments, refreshes from
      InfluxDB, and exposes `energy_hour` / `energy_day` /
      `energy_month` / `energy_year` values via REST + WebSocket.
- [ ] HP/HC classification continues to work — Consumption page shows
      `energy_hp` / `energy_hc` daily totals.
- [ ] All existing energy pages render with no code change.

## Validation

Manual sanity check, no automated test against external data:

1. Compare Sowel's daily kWh (Consumption + Production pages) with
   the Legrand mobile app and the Netatmo dashboard
   (`home.netatmo.com/control/dashboard`) — both still display the
   historical Shelly data because IT 085 migrated the equipment ids.
2. Cross-check Sowel's daily figures against Shelly's own
   `total_act_energy` deltas exposed in the device data table:
   `daily kWh ≈ counter[end_of_day] − counter[start_of_day]` per
   channel.
3. Spot-check HP / HC totals against the configured tariff schedule.

A daily diff < 3 % between Sowel and Shelly's own counters is the bar.
Larger drift means the synthesis or the reset detection is broken.

## Edge cases

- **First-ever em1data event for a new install** : no baseline → emit
  0 and store the current cumul as baseline.
- **Plugin restart** : load last forward/reverse from `device_data`
  via DeviceManager → first delta after restart is the "missed window"
  during downtime (small).
- **Counter reset** (current < last) → emit 0, refresh baseline.
- **Out-of-order MQTT messages** : same handling as reset (delta < 0
  → emit 0). MQTT QoS 0 within a single broker on the same VM makes
  this rare in practice.
- **Shelly offline** : no events; existing `online` LWT handling
  already flips device status. When it comes back, first `em1data`
  produces a large delta that represents the missed window — accepted
  (better than losing it).
- **3rd CT (em2)** : still discovered as a device but no equipment
  binding, so no aggregator side effect.
