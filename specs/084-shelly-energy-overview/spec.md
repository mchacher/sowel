# Spec 084 — Shelly Energy Refactor: Guiding Principles

## Goal

Replace the current Legrand-based energy metering with a Shelly Pro 3EM
installation, while moving the long-term raw data archive **out of Sowel's
lifecycle** so that the energy collection survives every Sowel restart.

The deliverable is **not a single PR** but a sequence of four independent
iterations (specs 085 → 088), each shippable on its own. Iterations are
ordered so that Legrand keeps running until iteration 2 — that gives a real
in-house comparison window to validate Shelly's data quality before
switching the energy aggregator over.

## Guiding principles

### 1. Sowel stays a monolith deployable

The default `docker-compose.yml` (Sowel + its own InfluxDB) keeps working
unchanged for users who don't do energy metering. Everything below is
opt-in.

### 2. Two artefacts, no tight coupling

- **Artefact A — Sowel integration plugins** (specs 085, 086, 088). Live
  ingestion, role bindings, gap backfill. Depend on Sowel only.
- **Artefact B — `energydata-stack`** (spec 087). Independent Docker stack
  on the same VM (or any other) with Mosquitto consumer (Telegraf), a
  dedicated InfluxDB, and Grafana. Does NOT depend on Sowel — runs even
  when Sowel is down.

The two artefacts share **only the MQTT bus**. Both subscribe to the same
broker (the `mosquitto` systemd service that already exists on `sowelox`).
Shelly publishes once, both consumers read independently. No cross-stack
queries required.

### 3. Per-channel forward + reverse counters, no net-signed meter

Shelly Pro 3EM exposes, per CT channel:

- `aenergy.total` — cumulative active energy when P > 0 (forward / import / production)
- `ret_aenergy.total` — cumulative active energy when P < 0 (reverse / export)
- `act_power` — instantaneous active power (~1 Hz)

Mathematics:

```
ΔForward = aenergy.total[t+Δt] − aenergy.total[t]   = ∫(P > 0) dt   over Δt
ΔReverse = ret_aenergy.total[t+Δt] − ret_aenergy.total[t] = ∫(P < 0) dt
```

Hardware integration runs at ~1 kHz inside Shelly. Reading these two
counters at any cadence (1/s, 1/min, 1/hour) yields **exact** energy
deltas — no precision loss vs integrating `act_power` ourselves at 1 Hz.

The only counter that **must never** be used is a single net-signed
accumulator (forward minus reverse summed), which would erase fast
import/export cycles within the same minute. Shelly does NOT use that;
two separate counters are exposed precisely to avoid the trap.

### 4. CT semantic lives in Sowel, not in Shelly

Shelly's per-channel data is semantically neutral. The mapping
"channel A → grid, channel B → solar, channel C → another load" is done in
Sowel via equipment types:

- Grid CT → `main_energy_meter` equipment (uses `aenergy.total` as `energy_forward` = imports, `ret_aenergy.total` as `energy_reverse` = exports).
- Solar production CT → `energy_production_meter` equipment.
- Sub-load CT (optional, e.g. pool heat pump) → `energy_meter` equipment (purely informational, never summed into the household balance).

Shelly-side configuration that **does** matter and must be set at install:

- Profile = `EM1` (3 independent single-phase channels), not `EM` (3-phase combined).
- Polarity inversion per channel if a CT is clamped backwards.
- Voltage tap and CT ratio calibration.

### 5. Live consumption is computed UI-side at 1 Hz

Real-time household power balance (`P_grid + P_solar = P_house`) is computed
in the React UI from the WS event stream of `act_power` per channel. No
need to integrate cross-channel power into a single signal — integration
is linear and aggregating per-channel forward/reverse counters at a coarser
cadence gives the exact same energy as integrating the cross-sum at 1 Hz.

### 6. Legrand stays alive until validation passes

Iterations 1 and 2 deliberately keep the Legrand integration enabled.
Shelly devices come up as generic `energy_meter` first (iteration 1),
allowing side-by-side power and energy comparison. Only once daily energy
matches within ±3% over a multi-week window do we promote Shelly channels
to `main_energy_meter` / `energy_production_meter` and disable Legrand
(iteration 2). A failed comparison rolls back without data loss.

### 7. Backfill is the safety net, not the primary path

Iteration 4 introduces a backfill plugin that, on Sowel boot, fills any
gaps in Sowel's internal Influx by querying `energydata-stack`'s Influx.
This is opt-in and requires `energydata-stack` to be deployed first
(iteration 3). It is the answer to "Sowel was down 4 hours, how do I show
a continuous energy chart afterwards?" but it is NOT the primary
mechanism — the primary mechanism is that Sowel's own pipeline is
robust enough on its own and the gaps are usually short.

## Iteration overview

| It  | Spec | Title                                | Touches                                                                            |
| --- | ---- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | 085  | sowel-plugin-shelly-em (live)        | Plugin Sowel; live UI; no role bascule                                             |
| 2   | 086  | Shelly drives the energy roles       | Equipment role bascule; Legrand disable; alias `energy_forward` / `energy_reverse` |
| 3   | 087  | energydata-stack — **REJECTED**      | Replaced by hardware-native archive on Shelly Pro 3EM (see addendum below)         |
| 4   | 088  | Shelly plugin gap backfill (revised) | Plugin extension; queries `EM1Data.GetData` over HTTP-RPC; no external dependency  |

Each spec has its own acceptance criteria and rollback plan; nothing in a
later iteration retroactively breaks an earlier one.

## What is OUT of scope of this initiative

- Multi-tariff configurations beyond HP/HC (already supported by the existing aggregator).
- Switching tariff classification from Sowel-side to Influx-side. We keep
  the existing Sowel logic; Telegraf in iteration 3 only archives raw data,
  it does not classify.
- Per-load self-consumption breakdown ("the heat pump used 60% solar, 40% grid").
  This requires power-level integration across two channels and is left
  for a future iteration (will need spec 0XX).
- Replacement of mosquitto. We continue to use the existing systemd
  service that Sowel already shares with z2m, lora2mqtt, etc.

## Addendum (2026-05-03) — IT 3 dropped, IT 4 reworked

Iterations 1 and 2 shipped as designed. While preparing iteration 3
(the `energydata-stack` external archive), live verification on the
production Pro 3EM showed that the device itself satisfies the "raw
data survives Sowel downtime" requirement: the firmware records at
least 60 days of 1-minute energy data in flash and exposes it through
the `EM1Data.GetData` RPC. The archive survives device power-cycles
and is accessible over HTTP or MQTT.

That changes the cost-benefit of two iterations:

- **Iteration 3 (`energydata-stack`)** is **rejected**. Building a
  parallel Telegraf + Influx + Grafana stack to replicate what the
  hardware already does would create a second source of truth, double
  the operational burden, and duplicate the existing Sowel UI. The
  original analysis is preserved in
  [spec 087](../087-energydata-stack/spec.md) for record.
- **Iteration 4 (`sowel-plugin-energy-backfill`)** is **reworked**.
  Instead of querying an external archive, the backfill ships as an
  extension of the Shelly plugin (`sowel-plugin-shelly-mqtt` v1.2.0+)
  that queries the device's own historical data on boot and on a
  scheduled basis. See [spec 088 v2](../088-energy-backfill-plugin/spec.md).

Principle 7 of this overview ("Backfill is the safety net") is
unchanged in spirit but its mechanics are different:

> The backfill no longer depends on a separate Influx instance; it
> queries the Shelly device's `EM1Data.GetData` RPC and replays
> per-minute records through the existing live event pipeline. This
> preserves the principle that backfill is a safety net rather than the
> primary path — live MQTT events remain the primary mechanism, and the
> backfill only runs to repair detected gaps.

No change to iterations 1, 2, or to the data model.
