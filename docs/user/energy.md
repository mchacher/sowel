# Energy Monitoring

Sowel includes built-in energy monitoring that tracks your home's electricity consumption over time. It supports HP/HC (peak/off-peak) tariff classification and autoconsumption tracking for solar production.

## Overview

Energy monitoring works through a pipeline:

1. An **energy meter equipment** (e.g., Netatmo Energy module on your main breaker) reports consumption data
2. Sowel writes this data to **InfluxDB**, a time-series database
3. InfluxDB automatically aggregates the data into hourly and daily summaries
4. The **Energy page** in the UI displays charts and totals

## Requirements

- An energy meter device connected to one of your integrations (e.g., Netatmo Home Control)
- An equipment of type **main_energy_meter** configured in Sowel
- InfluxDB running (included in the Docker setup)

!!! info "InfluxDB is automatic"
InfluxDB is mandatory and starts with Sowel. On first launch, Sowel automatically creates the required buckets, downsampling tasks, and energy aggregation tasks. No manual InfluxDB configuration is needed.

## Setting up energy monitoring

### Step 1: Connect your energy integration

Make sure your energy data source is configured in **Administration > Integrations**. For Netatmo, this means setting up the Netatmo Home Control integration with your OAuth credentials.

### Step 2: Create the energy equipment

Go to **Administration > Equipments** and create an equipment:

- **Type**: Main Energy Meter
- **Zone**: assign to a relevant zone (e.g., Home or Utility Room)
- **Bind** to your energy meter device

Once bound, Sowel starts recording energy data to InfluxDB.

### Step 3: (Optional) Configure HP/HC tariffs

If your electricity plan uses peak (HP) and off-peak (HC) hours, configure the tariff schedule so Sowel can split your consumption accordingly.

Go to **Settings > Tariff Configuration**:

1. Define your tariff schedule -- which hours are HP and which are HC
2. You can set different schedules for different days of the week
3. Optionally enter your HP and HC prices per kWh

**Example: Standard French HP/HC tariff**

| Hours          | Tariff        |
| -------------- | ------------- |
| 06:00 -- 22:00 | HP (peak)     |
| 22:00 -- 06:00 | HC (off-peak) |

!!! tip
If no tariff is configured, all consumption is classified as HP by default. The Energy page still works -- you just do not see the HP/HC breakdown.

### Step 4: (Optional) Set up production tracking

If you have solar panels, create an equipment of type **energy_production_meter** and bind it to your production meter device. Sowel will then track:

- **Grid consumption** -- energy drawn from the grid
- **Autoconsumption** -- energy produced and consumed locally
- **Total consumption** -- grid + autoconsumption

## Using the Energy page

Navigate to **Energy** in the sidebar. The page shows:

### Period selector

Switch between different time views:

| Period    | What it shows                                |
| --------- | -------------------------------------------- |
| **Day**   | Hourly consumption bars for a selected day   |
| **Month** | Daily consumption bars for a selected month  |
| **Year**  | Monthly consumption bars for a selected year |

Use the navigation arrows to move between dates.

### Consumption chart

A bar chart showing energy consumption over the selected period. Each bar is color-coded:

- **Blue** -- grid consumption
- **Light blue** -- off-peak (HC) portion, if HP/HC is configured
- **Green** -- autoconsumption, if production tracking is configured

### Totals

Below the chart, you see summary totals:

- **Grid consumption** in kWh
- **HP / HC split** in kWh (if tariff is configured)
- **Autoconsumption** in kWh (if production is tracked)
- **Total consumption** in kWh

### Production page

If you have solar production configured, a **Production** tab appears showing:

- Production bar chart (same period selector as consumption)
- Production totals
- Autoconsumption ratio

## Data pipeline

Understanding how data flows helps with troubleshooting:

```
Energy meter device
  --> 30-minute energy readings
    --> InfluxDB "sowel" bucket (7-day retention, raw data)
      --> Hourly aggregation task
        --> InfluxDB "sowel-energy-hourly" bucket (2-year retention)
          --> Daily aggregation task
            --> InfluxDB "sowel-energy-daily" bucket (10-year retention)
```

- **Day view**: For recent days (less than a week old), the chart queries raw data for real-time accuracy. For older days, it uses the hourly bucket.
- **Month/Year view**: Uses the daily bucket for efficient queries over long periods.

## Troubleshooting

### No data appears on the Energy page

1. Check that your energy integration is connected (green indicator in Integrations)
2. Verify that the energy equipment exists and is bound to a device
3. Wait for at least one polling cycle (typically 30 minutes for Netatmo)
4. Check the logs for any error messages related to energy or InfluxDB

### HP/HC split shows everything as HP

This means no tariff schedule is configured. Go to **Settings > Tariff Configuration** and define your HP/HC hours.

### Old data is missing

Data older than 7 days is only available if the hourly aggregation task has run successfully. Check that InfluxDB is running and that Sowel has created the aggregation tasks (this happens automatically on startup).
