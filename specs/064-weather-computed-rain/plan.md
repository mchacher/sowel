# Implementation Plan — Spec 064

## Strategy

Three slices, implemented in order:

1. **A** — WeatherAggregator backend (computed rain data)
2. **B** — History query aggregation function (sum vs mean by category)
3. **C** — HistoryPanel UI (computed data in charts + bar chart by category)

Each slice leaves the codebase compilable and tested.

---

## Slice A — WeatherAggregator

### A.1 — Create `src/weather/weather-aggregator.ts`

Follow the EnergyAggregator pattern:

- Constructor: `equipmentManager`, `influxClient`, `eventBus`, `logger`
- `start()`: discover weather equipments with historized rain bindings, register as ComputedDataProvider, initial InfluxDB load, subscribe to events, start 15-min periodic refresh
- `scheduleRefresh(equipmentId)`: debounced 5s
- `refreshFromInfluxDB(equipmentId)`: Flux query `sum(rain)` over 1h and 24h windows
- `getComputedDataForEquipment(equipmentId)`: return `rain_1h` + `rain_24h` as `ComputedDataEntry[]`
- `stop()`: clear timers

### A.2 — Wire in `src/index.ts`

After the EnergyAggregator setup block (~line 345):

```typescript
const weatherAggregator = new WeatherAggregator(equipmentManager, influxClient, eventBus, logger);
await weatherAggregator
  .start()
  .catch((err) => logger.warn({ err }, "Weather aggregator start failed"));
```

### A.3 — Test `src/weather/weather-aggregator.test.ts`

Test cases:

- Weather equipment with historized rain binding → computed entries returned
- No rain binding → no computed entries
- Non-weather equipment → no computed entries
- Null InfluxDB result → computed values are `null` (not 0)

### A.4 — Validate slice A

```bash
npx tsc --noEmit
npx eslint src/ --ext .ts
npx vitest run
```

---

## Slice B — History query aggregation

### B.1 — Add `CUMULATIVE_CATEGORIES` constant

In `src/history/history-query.ts`, add:

```typescript
const CUMULATIVE_CATEGORIES = new Set(["rain", "energy"]);
```

### B.2 — Modify aggregation in Flux queries

Where `aggregateWindow` is used with `fn: mean`, check the category and use `fn: sum` for cumulative categories. Apply to all resolution paths (1h, 1d).

### B.3 — Forward category in history API

In `src/api/routes/history.ts`, ensure the `category` from the binding lookup is passed through to `queryHistory()`. Verify it's already done or add it.

### B.4 — Support computed data aliases in history API

When the requested alias doesn't match a data binding, check if it matches a computed data alias (e.g. `rain_24h`). If so, query InfluxDB using the underlying rain binding's measurement filter with the appropriate aggregation window.

### B.5 — Validate slice B

```bash
npx tsc --noEmit
npx vitest run
```

---

## Slice C — HistoryPanel UI

### C.1 — Add `CUMULATIVE_CATEGORIES` to UI

In `ui/src/components/history/history-utils.ts`:

```typescript
export const CUMULATIVE_CATEGORIES = new Set(["rain", "energy"]);
```

### C.2 — Generalize HistoryBarChart

In `ui/src/components/history/HistoryBarChart.tsx`:

- Remove energy-specific Wh→kWh conversion
- Use `unit` prop for Y-axis and tooltip formatting
- Generic tooltip: `"{value} {unit} · {period}"`

### C.3 — Add computed data entries to HistoryPanel

In `ui/src/components/history/HistoryPanel.tsx`:

- Receive computed data from equipment (passed via props or fetched from API)
- Filter computed entries with category in `CUMULATIVE_CATEGORIES`
- Add them to the chart list alongside historized bindings
- Mark them as computed (for potential visual distinction)

### C.4 — Generic chart type selection

In `ui/src/components/history/HistoryPanel.tsx`:

- Replace `chart?.category === "energy"` with `CUMULATIVE_CATEGORIES.has(chart?.category ?? "")`
- Both `rain` and `energy` categories now render as `HistoryBarChart`

### C.5 — Validate slice C

```bash
cd ui && npx tsc -b --noEmit && npx eslint .
```

---

## Validation Plan

### Automated checks

```bash
# Backend
npx tsc --noEmit
npx eslint src/ --ext .ts
npx vitest run

# UI
cd ui && npx tsc -b --noEmit && npx eslint .
```

All must pass with zero errors.

### Manual test plan

1. **Weather equipment rain_1h / rain_24h**:
   - Open Station Météo equipment detail page
   - Verify `rain_1h` and `rain_24h` appear as computed values (section capteurs or dedicated section)
   - If InfluxDB has rain history: values should be > 0 after recent rain
   - If InfluxDB has no rain history: values should show "—" (null), not "0"

2. **Bar chart for rain**:
   - On the Station Météo history panel, expand the `rain` binding chart
   - Verify it renders as a bar chart (not a line chart)
   - Switch time ranges (24h, 7d, 30d) — verify bar granularity adapts (hourly → daily)
   - Tooltip shows "X.X mm · period"

3. **Bar chart for energy** (non-regression):
   - On an energy meter equipment, expand an energy binding chart
   - Verify it still renders as a bar chart
   - Verify values and tooltip are correct

4. **Line chart unchanged** (non-regression):
   - On any sensor equipment, expand temperature/humidity chart
   - Verify it still renders as a line chart

5. **Computed data in history panel**:
   - Verify `rain_1h` and `rain_24h` appear in the chart list of the weather equipment
   - Click to expand — verify bar chart renders with correct data

---

## Risks & Mitigations

| Risk                                                                                | Mitigation                                                                                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| InfluxDB raw bucket only has 7d retention — rain_24h bar chart over 30d has no data | Acceptable for now. Spec 065 (downsampling) will extend retention. UI shows empty bars gracefully.                         |
| Energy bar chart regression — generalizing HistoryBarChart breaks energy formatting | Test energy charts explicitly in validation. The Wh→kWh conversion can be kept as a category-specific formatter if needed. |
| No rain data in InfluxDB on local dev (no real pluviomètre)                         | Test with mock InfluxDB data or on production (sowelox). Unit tests mock the InfluxDB responses.                           |
| Computed data aliases conflict with regular binding aliases                         | Use distinct aliases (`rain_1h`, `rain_24h`) that don't overlap with any device key.                                       |

---

## Out of Scope

- InfluxDB downsampling buckets for weather (spec 065)
- Other weather computed data (dew_point, ETo, pressure_trend)
- Dedicated rain dashboard page
- Modifications to the Energy page (uses its own chart infra)
- Step charts for binary data (motion) — future enhancement
