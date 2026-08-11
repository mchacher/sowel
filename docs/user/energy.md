# Energy Monitoring

Sowel includes built-in energy monitoring that tracks your home's electricity consumption and (optionally) your solar production over time. It supports peak / off-peak tariff classification, autoconsumption tracking, and a by-usage breakdown when you instrument dedicated circuits.

## The three energy equipment types

Energy monitoring in Sowel is **integration-agnostic**. Any plugin that reports energy or power data on a device can feed the energy pipeline, as long as the device is bound to one of these three equipment types.

| Equipment type            | What it represents                                                   | Required device data                                           |
| ------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `main_energy_meter`       | Your main grid meter (whole-home import / export)                    | Cumulative energy (Wh), or a signed grid energy delta per tick |
| `energy_meter`            | A submeter on a dedicated circuit (heat pump, pool, EV charger, ...) | Cumulative energy (Wh) **or** instantaneous power (W)          |
| `energy_production_meter` | Your solar (or other local production) meter                         | Cumulative production energy (Wh)                              |

You can mix and match: a setup with only a main meter is fine, you do not need solar to use the Energy page. Conversely, you can have many submeters without a main meter — you will just lose the "Other" residual on the by-usage view.

!!! info "Power-only submeters"
Cheap zigbee clamps that report only `power` (W) and not `energy` (Wh) are supported for submeters. Sowel integrates the power signal locally into a Wh stream attributed to the submeter equipment, with the same per-minute cadence as the main meter. State survives restarts.

## How the data flows

```
Energy meter device (any integration)
  -> Plugin reports `energy` (Wh) or `power` (W)
    -> HistoryWriter writes per-minute points to InfluxDB
      -> EnergyAggregator computes hour / day / month / year cumuls
        -> Energy page renders charts and totals
```

InfluxDB stores raw points in a short-retention bucket, then automatic downsampling tasks aggregate them into hourly and daily buckets with much longer retention. The Energy page picks the right bucket transparently based on the time range you are looking at.

!!! info "InfluxDB is automatic"
InfluxDB is mandatory and starts with Sowel via Docker Compose. On first launch, Sowel auto-creates the required buckets, downsampling tasks, and energy aggregation tasks. No manual InfluxDB configuration is needed.

## Setting up energy monitoring

### Step 1: Connect an energy integration

Install a plugin that provides energy meter devices (browse the catalogue from **Administration > Plugins**) and configure it from **Administration > Integrations**. Any plugin that surfaces a device exposing `energy` or `power` data is eligible.

### Step 2: Create the main energy meter equipment

Go to **Administration > Equipments** and create an equipment:

- **Type**: Main Energy Meter
- **Zone**: typically the Home root, or a Utility zone
- **Bind** to your grid meter device's `energy` data

Once bound, Sowel starts writing one energy point per minute to InfluxDB.

### Step 3: (Optional) Add a production meter

If you have local production (solar panels typically), create an equipment of type **Energy Production Meter** and bind it to your production meter device. With both a main meter and a production meter in place, Sowel computes:

- **Grid consumption**: energy drawn from the grid
- **Autoconsumption**: energy produced and consumed in the house
- **Grid injection**: energy produced and pushed to the grid
- **Total consumption**: grid + autoconsumption

### Step 4: (Optional) Configure peak / off-peak tariffs

If your electricity plan splits hours into peak and off-peak, configure the schedule so Sowel can break down your consumption.

Go to **Settings > Administration > Energy tariffs**:

![Tariff configuration](../screenshots/energy-tariff-settings-en.png)

1. Optionally enter your peak and off-peak prices per kWh (used for cost views; classification works without them)
2. Define your time slots: which hours are peak and which are off-peak
3. You can add as many slots as you need to cover the 24 hours of the day

If no tariff is configured, all consumption is classified as peak by default — you simply do not see the split.

### Step 5: (Optional) Add submeters for a by-usage breakdown

To know how your main meter's consumption splits across circuits, add an `energy_meter` equipment for each circuit you instrument.

1. Install a zigbee energy clamp, smart plug, or Wi-Fi meter on the dedicated circuit
2. Go to **Administration > Equipments** and create an equipment of type **Energy Meter**
3. Bind it to the device's `energy` (Wh) data, or — if your device reports only `power` (W) — to its `power` data: Sowel integrates the power signal into a Wh stream automatically

Once at least one submeter is configured, the **By usage** toggle appears on the Consumption page. The toggle is hidden when no submeter exists.

## Using the Energy section

The sidebar groups the energy views under **Energy**:

- **Live**: instant flow between grid, production, and house consumption
- **Consumption**: historical consumption with peak / off-peak split and self-consumption overlay
- **Production**: historical solar production with autoconsumption / injection split

### Live view

The Live view shows what is happening right now — power values updated in real time via WebSocket.

![Live energy flow](../screenshots/energy-live-en.png)

The diagram shows three boxes (Grid, Consumption, Production) with arrows indicating the direction of energy flow. When solar production exceeds in-house consumption, a "Solar surplus" indicator appears, and the share of solar going to the grid versus to the house is shown on the arrows.

Tiles are hidden when their underlying equipment is not configured: with no production meter, only Grid and Consumption are shown.

### Consumption view

Pick a period (Day, Week, Month, Year) and navigate dates with the arrows. The chart renders bars for each time bucket of the selected period.

![Daily consumption chart](../screenshots/energy-consumption-day-en.png)

Color coding on the **Total** chart:

| Color      | Meaning                                                  |
| ---------- | -------------------------------------------------------- |
| Dark blue  | Peak-hours grid consumption                              |
| Light blue | Off-peak-hours grid consumption                          |
| Green      | Autoconsumption (only when a production meter is set up) |

Below the chart, totals are shown in kWh: grid (split into peak / off-peak), autoconsumption, and total (with the self-consumption share as a percentage).

#### Wh / € unit toggle

A **Wh / €** segmented toggle sits next to the period selector at the top of the page. In **€** mode, every kWh figure on the bar chart (Y axis, bar height, tooltip) and on the totals card is replaced by the corresponding cost in euros, computed from the prices you entered in **Settings > Energy tariffs**. The toggle is disabled — with a tooltip pointing back to the tariff settings — until you set at least one of the HP / HC prices to a non-zero value.

Pricing is applied at read time, so changing your tariff (after a contract renegotiation, for example) re-values past consumption with the new prices. Autoconsumption has no billed cost and is therefore hidden from the chart in € mode.

#### Total / By usage toggle

When at least one submeter is configured, a **Total / By usage** toggle appears above the chart. The **By usage** view replaces the peak / off-peak split with one stack per submeter, plus an **Other** stack for the residual that the main meter saw but no submeter accounted for.

![By usage breakdown](../screenshots/energy-consumption-by-usage-en.png)

Submeters use a deterministic color palette so the same circuit keeps the same color across days and views. The "Other" stack is clamped at zero, so a submeter that briefly overshoots the main meter (due to sampling skew) cannot make it negative.

Totals widgets (peak / off-peak, autoconsumption) stay unchanged when you toggle modes.

#### Longer periods

Switching to **Month** or **Year** keeps the same colors and totals, but each bar represents a day (Month view) or a month (Year view).

![Monthly consumption chart](../screenshots/energy-consumption-month-en.png)

### Production view

The Production page renders solar (or other local production) history:

![Daily production chart](../screenshots/energy-production-day-en.png)

| Color       | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| Light green | Autoconsumption — produced and consumed locally       |
| Dark green  | Grid injection — produced and pushed back to the grid |

Totals below the chart sum the two slices into the day's, month's, or year's total production.

## Surplus arbitration

When you have solar production, several automations may want the same surplus at the same time (pre-cooling the house, running the pool pump, heating water). Left uncoordinated they fight over it: each switches on when it sees export, together they overshoot, the export collapses, and everything switches off again. The **surplus arbiter** is the single referee that hands the surplus out in an order **you** decide.

It is **off by default** and changes nothing until you enable it. On a home without solar production it stays hidden.

### Declaring a flexible load

On an equipment that can be switched on and off (pool pump, water heater, a switch driving a heater), open its page and turn on **Energy management**. You choose:

- **Class** — _Deferrable_ (can be switched off and caught up later, like a pool pump) or _Comfort_ (only ever gets a bonus on top of its normal operation, never switched off by the arbiter, like an air conditioner). Sowel pre-selects the right class from the equipment type; you can override it.
- **Nominal power** — pre-filled from the equipment's own measurement when a clamp is bound.
- **Minimum on / off** — how long it must stay on once started, and rest before restarting (protects a compressor from short-cycling).

Enabling this only _declares_ the load. Nothing acts on it until the arbiter itself is enabled.

### Enabling the arbiter and setting priority

Go to **Settings > Administration > Energy**, enable **Surplus arbiter**, and order your flexible loads in the priority list. The list is read both ways: the surplus is offered top-down, and when it runs short the bottom load is the first to step back. Advanced timing thresholds live behind a fold with sensible defaults.

### Reading it on the Live page

The **Energy > Live** page gains a surplus-arbitration panel with three parts:

- an **allocation bar** showing where the production is going right now (household, each granted load, free surplus), and a line naming any load that is waiting and why;
- a **day timeline** with one lane per flexible load — green where it held the surplus, a red marker (with the reason on hover) where it was stepped back;
- a **decision journal** in plain language, so nothing the arbiter does is a mystery.

### You always win

If you switch a flexible load on or off yourself — in the app, with a physical button, or the switch on the wall — the arbiter steps back and leaves it alone for two hours. Its equipment page shows _Manual until HH:MM_ with a **resume control now** button if you want to hand it back sooner.

## Data pipeline

Understanding how data flows helps with troubleshooting:

```
Plugin reports energy or power
  -> per-minute energy points written to InfluxDB "sowel" bucket  (7-day retention)
    -> sowel-energy-sum-hourly task
      -> "sowel-energy-hourly" bucket  (2-year retention)
        -> sowel-energy-sum-daily task
          -> "sowel-energy-daily" bucket  (10-year retention)
```

The Energy page chooses the bucket based on the period:

- **Day view** for today and recent days: queries the raw bucket for real-time accuracy
- **Day view** for older days: queries the hourly bucket
- **Month / Year**: queries the daily bucket for fast, long-range queries

The aggregator also keeps in-memory cumuls (hour, day, month, year) that the Live view and Home page widgets read directly, refreshed on every new energy tick.

## Troubleshooting

### No data appears on the Energy page

1. Check that the integration providing your energy meter device is connected (green indicator in **Administration > Integrations**)
2. Verify the equipment exists (Main Energy Meter and/or Energy Production Meter) and is bound to a device that actually emits `energy` data
3. Wait for at least one polling / push cycle — exact frequency depends on the plugin, but typically a few minutes at most
4. Check **Settings > System > Logs** for messages from the `history-writer` or `energy-aggregator` modules

### Peak / off-peak shows everything as peak

This means no tariff schedule is configured. Go to **Settings > Administration > Energy tariffs** and define your slots.

### Old data is missing

Data older than 7 days lives only in the downsampled hourly and daily buckets. If those buckets are empty, the downsampling tasks have not run yet (they run once per hour and once per day). Check that InfluxDB is running and reachable, and inspect the logs of the `history-writer` module on startup — Sowel logs whether the tasks were created or already existed.

### By usage view shows a large "Other" residual

This means your submeters do not cover most of the main meter's consumption — which is normal: the main meter sees everything in the house, while submeters typically cover specific high-power circuits. The residual is "Other circuits".

If the residual is **negative** (clamped to zero in the chart), one of your submeters is reporting more than the main meter sees — usually a clamp wired backwards or a calibration mismatch. The integrator clamps negative power deltas at zero and logs a WARN once per occurrence.
