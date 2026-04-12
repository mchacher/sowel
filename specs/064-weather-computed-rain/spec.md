# Spec 064 — Weather computed rain data + cumulative bar charts

## Context

The `weather` equipment type exposes raw sensor bindings (temperature, humidity, rain, wind...) but no computed data. Some devices (e.g. Netatmo pluviomètre) expose `sum_rain_24` natively, but this is device-specific and not available on all rain gauges.

More broadly, the equipment history panel always renders line charts regardless of the data nature. Cumulative data (rain per period, energy per period) should be displayed as bar charts with scale adapted to the time range. This is a generic mechanism driven by the **data category**, not tied to a specific equipment type — any equipment with a historized `rain` or `energy` binding benefits automatically.

Additionally, computed data entries (like `rain_24h` or `energy_day`) are not currently visible in the equipment history panel. They should appear alongside regular bindings with their own charts.

This spec delivers three things:

1. **Computed rain data** on weather equipments — `rain_24h` and `rain_1h`, computed from InfluxDB history.
2. **Computed data in history panel** — generic: any computed data entry with historical backing appears as a chart in the equipment history panel.
3. **Chart type by data category** — generic: cumulative categories (`rain`, `energy`) render as bar charts with `sum()` aggregation; continuous categories render as line charts with `mean()`. Applies to all equipment types, not just weather.

This spec is a prerequisite for spec 063 (auto-watering recipe), which needs `rain_24h` as an input to decide whether to skip irrigation.

## Goals

1. Expose `rain_24h` and `rain_1h` as computed data on weather equipments with a historized `rain` binding
2. Show computed data entries in the equipment history panel (generic, all equipment types)
3. Select chart type (bar vs line) based on data category (generic, all equipment types)
4. Adapt bar chart time scale to the selected range
5. Use `sum()` aggregation for cumulative categories, `mean()` for continuous categories

## Non-Goals

- Other weather computed data (dew_point, ETo, pressure_trend, feels_like) — deferred until a concrete use case justifies them
- InfluxDB downsampling buckets for weather (spec 065 — long-term retention)
- Rain forecast analysis (already available as raw binding from weather_forecast equipment)
- Dedicated rain/weather dashboard page
- Modifying the Energy page (which has its own bar chart implementation)

## Functional Requirements

### FR1 — WeatherAggregator computed data provider

Create a `WeatherAggregator` service (same pattern as `EnergyAggregator`) that:

- On startup, scans all equipments of type `weather` for historized bindings with `category: "rain"`
- Registers as a `ComputedDataProvider` on `EquipmentManager`
- Computes and exposes:
  - `rain_1h` — sum of rain over the last 1 hour (mm), from InfluxDB
  - `rain_24h` — sum of rain over the last 24 hours (mm), from InfluxDB
- Refreshes on `equipment.data.changed` events for the `rain` alias (debounced, like EnergyAggregator)
- Also refreshes periodically (every 15 minutes) to keep the 24h window sliding

If the device natively exposes `sum_rain_1` or `sum_rain_24` as bound aliases on the equipment, the WeatherAggregator should still compute its own values from InfluxDB for consistency. The device values remain available as raw bindings; the computed values are the authoritative "Sowel-computed" versions.

### FR2 — Computed data in equipment history panel (generic)

The HistoryPanel on the equipment detail page currently only shows historized data bindings. It should also show computed data entries that have historical backing in InfluxDB.

This is a **generic mechanism** — not specific to weather or rain:

- The HistoryPanel receives the equipment's `computedData` entries
- For each computed entry that maps to an InfluxDB-queryable source, it appears in the chart list
- The chart fetches data from InfluxDB using the appropriate measurement/field and aggregation function

This benefits any equipment type that has computed data backed by InfluxDB (weather with `rain_24h`, energy meters with `energy_day`, etc.).

### FR3 — Chart type selection by data category (generic)

In the equipment history panel, select the chart type based on the data **category**, not the equipment type. This is a generic mapping that applies to all equipments:

| Data nature                  | Categories       | Chart type | Aggregation fn |
| ---------------------------- | ---------------- | ---------- | -------------- |
| Cumulative (discrete totals) | `rain`, `energy` | bar chart  | `sum()`        |
| Continuous (instant values)  | all others       | line chart | `mean()`       |

The set of cumulative categories is defined as a constant (e.g. `CUMULATIVE_CATEGORIES`), making it easy to extend later without code changes to the chart component.

The existing `HistoryBarChart` component is reused. The selection logic replaces the current hardcoded `category === "energy"` check with the generic set lookup.

### FR4 — Time scale adaptation for bar charts

Bar charts must adapt their bar width and aggregation window to the selected time range:

| Time range | Bar granularity | Each bar represents |
| ---------- | --------------- | ------------------- |
| 24h        | 1 hour          | Cumul over 1 hour   |
| 7d         | 1 day           | Cumul over 1 day    |
| 30d        | 1 day           | Cumul over 1 day    |
| 90d        | 1 week          | Cumul over 1 week   |

The InfluxDB query must use the matching `aggregateWindow` with `fn: sum` (not `mean`).

### FR5 — Unit display

- `rain_1h` and `rain_24h` computed data: unit `mm`, category `rain`
- Bar chart Y axis: show unit label
- Bar chart tooltip: show value + unit + period label (e.g. "2.4 mm · 14h–15h")

## Acceptance Criteria

- [ ] FR1: A weather equipment with a historized `rain` binding exposes `rain_1h` and `rain_24h` as computed data in the API response
- [ ] FR1: Values match InfluxDB `sum()` over the respective windows (±0.1 mm tolerance for rounding)
- [ ] FR1: Values refresh within 15 minutes even without new rain events
- [ ] FR2: Computed data entries with InfluxDB backing appear in the history panel chart list (generic, not limited to weather)
- [ ] FR2: Energy equipment computed data (`energy_day`) also appears in its history panel
- [ ] FR3: Rain and energy data render as bar charts; temperature, humidity, pressure, etc. render as line charts — on any equipment type
- [ ] FR3: The chart type selection is driven by a `CUMULATIVE_CATEGORIES` constant, not hardcoded per category
- [ ] FR4: Bar granularity matches the selected time range
- [ ] FR5: Units and tooltips display correctly
- [ ] Existing line chart behavior unchanged for non-cumulative data
- [ ] TypeScript compiles clean, all tests pass, lint clean

## Edge Cases

- **No rain history available** (InfluxDB empty or not configured): `rain_1h` and `rain_24h` should be `null`, not `0` — null means "no data", 0 means "it didn't rain"
- **Equipment has `rain` binding but it's not historized**: no computed data generated (InfluxDB has nothing to query)
- **Multiple rain bindings** on same equipment (e.g. two rain gauges): sum across all historized rain bindings
- **Device also exposes `sum_rain_24` as a raw binding**: both coexist — raw binding shows device value, computed shows Sowel-calculated value. No conflict.
- **InfluxDB down**: computed data returns null, bar charts show empty state
- **Energy equipment with no computed data**: no bar chart shown (no data to display) — only equipments with actual computed entries get charts
- **New cumulative category added later**: just add to `CUMULATIVE_CATEGORIES` set — no chart component changes needed

## Related

- **Prerequisite for**: spec 063 (auto-watering recipe) — needs `rain_24h` as input
- **Follow-up**: spec 065 (weather downsampling) — InfluxDB hourly/daily buckets for long-term rain data beyond 7-day raw retention
- **Pattern follows**: `EnergyAggregator` in `src/energy/energy-aggregator.ts`
- **UI component reused**: `HistoryBarChart` in `ui/src/components/history/HistoryBarChart.tsx`
