# Architecture — Spec 064

## Overview

Two independent subsystems, connected by the existing `ComputedDataProvider` and `HistoryPanel` infrastructure:

1. **WeatherAggregator** — backend service that computes `rain_1h`/`rain_24h` from InfluxDB, exposes via ComputedDataProvider (same pattern as EnergyAggregator)
2. **HistoryPanel chart type** — UI selects bar/line chart based on a `CUMULATIVE_CATEGORIES` set, and adds computed data entries to the chart list

## Backend changes

### New file: `src/weather/weather-aggregator.ts`

Follows the `EnergyAggregator` pattern exactly:

```typescript
export class WeatherAggregator {
  private equipmentManager: EquipmentManager;
  private influxClient: InfluxClient;
  private eventBus: EventBus;
  private logger: Logger;

  // Cache: equipmentId → { rain1h, rain24h, lastUpdated }
  private cache = new Map<string, RainCumuls>();
  // Equipment IDs with historized rain bindings
  private rainEquipmentIds = new Set<string>();
  // Debounce timers
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  // Periodic refresh interval
  private periodicInterval: NodeJS.Timeout | null = null;
}
```

**Lifecycle:**

1. `start()`:
   - `discoverRainEquipments()` — scan all `weather` equipments for historized bindings with `category === "rain"`
   - `registerComputedDataProvider()` — register with EquipmentManager
   - Initial load from InfluxDB for all discovered equipments
   - Subscribe to `equipment.data.changed` events where alias matches rain binding
   - Start 15-minute periodic refresh (for sliding window)

2. `scheduleRefresh(equipmentId)` — debounced (5s), calls `refreshFromInfluxDB(equipmentId)`

3. `refreshFromInfluxDB(equipmentId)` — queries InfluxDB:

   ```flux
   // rain_1h: sum of rain from raw bucket over last 1 hour
   from(bucket: "${bucket}")
     |> range(start: -1h)
     |> filter(fn: (r) => r._measurement == "equipment_data")
     |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
     |> filter(fn: (r) => r.category == "rain")
     |> filter(fn: (r) => r._field == "value_number")
     |> sum()

   // rain_24h: sum of rain from raw bucket over last 24 hours
   // Same query with range(start: -24h)
   ```

4. `getComputedDataForEquipment(equipmentId)` → returns:
   ```typescript
   [
     { alias: "rain_1h", value: 0.4, unit: "mm", category: "rain", lastUpdated: "..." },
     { alias: "rain_24h", value: 2.8, unit: "mm", category: "rain", lastUpdated: "..." },
   ];
   ```

**Wiring in `src/index.ts`:**

```typescript
// After EnergyAggregator setup (~line 345)
const weatherAggregator = new WeatherAggregator(equipmentManager, influxClient, eventBus, logger);
await weatherAggregator
  .start()
  .catch((err) => logger.warn({ err }, "Weather aggregator start failed"));
```

### Modified: `src/history/history-query.ts`

Add `aggregationFn` parameter to `queryHistory()`:

Currently, all queries use `mean()` for aggregation (except energy which has its own path). Add support for `sum()` when the category is cumulative:

```typescript
const CUMULATIVE_CATEGORIES = new Set(["rain", "energy"]);

function getAggregationFn(category?: string): string {
  return CUMULATIVE_CATEGORIES.has(category ?? "") ? "sum" : "mean";
}
```

This affects the Flux query's `aggregateWindow` call:

```flux
|> aggregateWindow(every: ${window}, fn: ${aggregationFn}, createEmpty: false)
```

### Modified: `src/api/routes/history.ts`

Pass the `category` to `queryHistory()` so it can select the right aggregation function. The category is already looked up from the binding — just forward it.

Also add support for querying computed data aliases: when the alias doesn't match a data binding, check if it's a computed data alias and query InfluxDB using the underlying source binding's measurement/field.

## Frontend changes

### Modified: `ui/src/components/history/HistoryPanel.tsx`

**1. Add computed data to chart list:**

Currently the panel only shows `historizedBindings` (filtered from data bindings). Extend to also include computed data entries that have category in `CUMULATIVE_CATEGORIES`:

```typescript
// Existing: filter historized bindings
const historizedBindings = bindings.filter((b) => b.effectiveOn && !INTERNAL_ALIASES.has(b.alias));

// New: add computed data entries with cumulative categories
const computedCharts = (equipment.computedData ?? [])
  .filter((c) => CUMULATIVE_CATEGORIES.has(c.category ?? ""))
  .map((c) => ({
    alias: c.alias,
    category: c.category,
    unit: c.unit,
    isComputed: true,
  }));

// Merge both lists for the chart selector
const allCharts = [...historizedBindings, ...computedCharts];
```

**2. Chart type selection by category:**

Replace the hardcoded `category === "energy"` check with a generic set:

```typescript
const CUMULATIVE_CATEGORIES = new Set(["rain", "energy"]);

// In render:
{CUMULATIVE_CATEGORIES.has(chart?.category ?? "") ? (
  <HistoryBarChart
    points={chart?.points ?? []}
    range={range}
    resolution={chart?.resolution ?? "raw"}
    unit={unit}
  />
) : (
  <TimeSeriesChart ... />
)}
```

### Modified: `ui/src/components/history/HistoryBarChart.tsx`

Currently hardcoded for energy (Wh → kWh conversion, energy-specific tooltip). Generalize:

- Y-axis formatter: use unit from props, no Wh→kWh conversion (let the caller pass the right unit)
- Tooltip: show `"{value} {unit} · {period}"` generically
- Bar color: keep `#4F7BE8` (primary blue) as default, or accept as prop

### Constants

Add a shared constant for cumulative categories:

**`ui/src/components/history/history-utils.ts`:**

```typescript
export const CUMULATIVE_CATEGORIES = new Set(["rain", "energy"]);
```

## Data flow

```
Netatmo plugin polls pluviomètre
  → DeviceManager updates rain device data
    → HistoryWriter writes to InfluxDB (raw bucket, 7d retention)
    → EquipmentManager re-evaluates weather equipment bindings
      → emits equipment.data.changed (alias: "rain")
        → WeatherAggregator.scheduleRefresh()
          → queries InfluxDB sum(rain) over 1h and 24h
          → updates cache
          → ComputedDataProvider returns rain_1h, rain_24h
            → REST API includes them in equipment response
              → UI shows values in equipment card
              → HistoryPanel shows rain bar chart
```

## Files changed

| Domain  | File                                            | Change                                                        |
| ------- | ----------------------------------------------- | ------------------------------------------------------------- |
| Backend | `src/weather/weather-aggregator.ts` (NEW)       | WeatherAggregator service                                     |
| Backend | `src/index.ts`                                  | Wire WeatherAggregator after EnergyAggregator                 |
| Backend | `src/history/history-query.ts`                  | Add `sum()` aggregation for cumulative categories             |
| Backend | `src/api/routes/history.ts`                     | Forward category to queryHistory, support computed aliases    |
| UI      | `ui/src/components/history/HistoryPanel.tsx`    | Add computed data to chart list, generic chart type selection |
| UI      | `ui/src/components/history/HistoryBarChart.tsx` | Generalize tooltip/axis (remove energy-specific formatting)   |
| UI      | `ui/src/components/history/history-utils.ts`    | Add `CUMULATIVE_CATEGORIES` constant                          |

## No changes needed

- No SQLite migration (computed data is in-memory, not persisted)
- No new InfluxDB buckets (queries raw bucket only — downsampling is spec 065)
- No new API endpoints (computed data flows through existing equipment API)
- No new WebSocket events
- No new event bus events
- No changes to `src/shared/types.ts` (ComputedDataEntry already has all needed fields)
