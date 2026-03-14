# Architecture: 035 Energy Dashboard

## InfluxDB — 3-Bucket Architecture with Sum Aggregation

### Storage

Energy data uses the **existing `equipment_data` measurement**, category `energy`. No special measurement. Tags and fields identical to any other sensor:

- Tags: `equipmentId`, `alias` (= `energy`), `category` (= `energy`), `zoneId`, `type` (= `number`)
- Field: `value_number` (Wh for the 30-min period)

> **Important discovery (2026-03-14):** Despite requesting `scale=5min`, the Netatmo Energy API
> returns data at **30-minute granularity** only — 2 buckets per hour at ~xx:15 and ~xx:45.
> The poller queries aligned 30-min windows and writes points with the window's start timestamp
> (e.g., xx:00:00 and xx:30:00) for clean hourly aggregation.

### 3-Bucket Architecture

| Bucket                | Content              | Retention | Written by                              |
| --------------------- | -------------------- | --------- | --------------------------------------- |
| `sowel` (raw)         | 30-min energy points | 7 days    | HistoryWriter (via pipeline)            |
| `sowel-energy-hourly` | Hourly sums          | 2 years   | InfluxDB task `sowel-energy-sum-hourly` |
| `sowel-energy-daily`  | Daily sums           | 10 years  | InfluxDB task `sowel-energy-sum-daily`  |

### Sum Aggregation Tasks

Existing downsampling uses `mean` (temperature, humidity...). Energy needs **sum**.

**`sowel-energy-sum-hourly`** — runs every 1h, lookback **-7h** (aligned with poller's 6h sliding window):

```flux
from(bucket: "sowel")
  |> range(start: -7h)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(every: 1h, fn: sum, createEmpty: false)
  |> to(bucket: "sowel-energy-hourly")
```

**`sowel-energy-sum-daily`** — runs every 1d, lookback -2d:

```flux
from(bucket: "sowel-energy-hourly")
  |> range(start: -2d)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.category == "energy")
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false)
  |> to(bucket: "sowel-energy-daily")
```

The hourly task uses `-7h` (not `-1h`) to match the poller's 6h sliding window. After a restart with a gap, the poller replays 6h of raw data; the task must be able to re-aggregate all of it. InfluxDB's `to()` overwrites existing points with the same series+timestamp, so re-aggregation is idempotent.

## Data Pipeline: `sourceTimestamp`

### Problem solved

The Netatmo poller processes aligned 30-min windows, but the standard pipeline (DeviceManager → EventBus → HistoryWriter) writes InfluxDB points with "now" as timestamp. This creates irregular timestamps in the raw bucket, breaking clean hourly aggregation.

### Solution: `sourceTimestamp` propagated through the pipeline

An optional `sourceTimestamp` (epoch seconds) is passed through the entire event chain:

```
Poller: updateDeviceData(integration, device, payload, sourceTimestamp)
  → DeviceManager: emits device.data.updated { ..., sourceTimestamp }
    → EquipmentManager: emits equipment.data.changed { ..., sourceTimestamp }
      → HistoryWriter: point.timestamp(sourceTimestamp) instead of "now"
      → EnergyAggregator: uses event as trigger to refresh from InfluxDB
```

When `sourceTimestamp` is undefined (all non-energy data), the HistoryWriter behaves as before (InfluxDB uses "now"). This is a generic mechanism — any future integration needing aligned timestamps can use it.

### Types changes

```typescript
// In EngineEvent union (types.ts):
{ type: "device.data.updated"; ...; sourceTimestamp?: number; }
{ type: "equipment.data.changed"; ...; sourceTimestamp?: number; }
```

## Poller: 6h Sliding Window

### Design

On every poll cycle (~5 min), the poller:

1. **Computes the 6h lookback window**: last 12 aligned 30-min windows
2. **Applies a 25-min data lag guard**: only processes windows whose end is ≥25 min in the past (Netatmo data arrives with ~20-25 min lag — this ensures each window's data is stable/final)
3. **Queries each window** from Netatmo API (`getMeasure`, `scale=5min`, sum 5-min buckets within each 30-min window)
4. **Writes all windows** via `updateDeviceData(..., { energy: windowWh }, windowStart)` — the `sourceTimestamp` ensures aligned timestamps in InfluxDB

### Idempotent overwrites

InfluxDB overwrites points with the same series key (tags) + timestamp. Writing the same 30-min window multiple times with the same value is a no-op. This makes the system:

- **Robust to restarts**: no state to restore, just replay the last 6h
- **Self-healing**: if a previous write was lost (network issue), the next poll cycle re-writes it
- **No deduplication logic needed**: no `lastEnergyTimestamp` tracking in settings

### No re-verification

The 25-min data lag guard replaces the old re-verification/delta mechanism. By waiting for data stability, each window is written once with its final value. No deltas, no corrections, no risk of double-counting.

## EnergyAggregator: InfluxDB as Single Source of Truth

### Design

The EnergyAggregator computes live cumuls (hour/day/month/year) for the equipment detail UI. It uses InfluxDB as the **single source of truth** — no incremental in-memory accumulation.

**On event `equipment.data.changed` with `alias=energy` (used as trigger only):**

1. Debounce (5s) to avoid querying on every window of a batch
2. Query InfluxDB for current totals:
   - **Hour**: `sum()` of raw points in current hour (from `sowel` bucket)
   - **Day**: `sum()` of hourly points today (from `sowel-energy-hourly`)
   - **Month**: daily points this month excl. today + today's day total
   - **Year**: daily points this year excl. today + today's day total
3. Emit cumul values to UI via `equipment.data.changed` events

### Why not incremental accumulation

The previous approach (accumulate Wh deltas, track high-water marks, handle rollovers) was fragile:

- Required correct startup ordering (restore before poller starts)
- High-water mark could desync on InfluxDB query failures
- Rollover logic (hour/day/month/year) added complexity
- Sliding window replay caused double-counting without careful deduplication

The query-based approach is ~200 lines simpler, has zero state to manage, and is always correct because it reads from the authoritative data store.

### Cost

One InfluxDB query batch per poll cycle (~every 5 min) per energy equipment. For 1 equipment, that's 4 small queries every 5 min — negligible.

## Equipment Model: Compteur d'Energie

### Data aliases

| Alias          | Unit | Category | Type   | Historized | Source                                                            |
| -------------- | ---- | -------- | ------ | ---------- | ----------------------------------------------------------------- |
| `energy`       | Wh   | energy   | number | **yes**    | Wh per 30-min bucket — the real measurement (2 points/hour)       |
| `demand_30min` | W    | power    | number | no         | `energy x 2` — average power over last 30 min                     |
| `energy_day`   | Wh   | energy   | number | no         | Today's cumulative (from EnergyAggregator → InfluxDB query)       |
| `energy_hour`  | Wh   | energy   | number | no         | Current hour cumulative (from EnergyAggregator → InfluxDB query)  |
| `energy_month` | Wh   | energy   | number | no         | Current month cumulative (from EnergyAggregator → InfluxDB query) |
| `energy_year`  | Wh   | energy   | number | no         | Current year cumulative (from EnergyAggregator → InfluxDB query)  |

### Two Equipment types

Distinguished by `energyMeterType` field on the Equipment entity:

- **`consumption`** — Compteur Consommation — bound to NLPC Total / Shelly EM / etc.
- **`production`** — Compteur Production — bound to NLPC Solaire / inverter / etc.

Same Data model for both. The `energyMeterType` field tells the Energy Dashboard which chart to feed (consumption vs. production). Set via a dropdown in Equipment create/edit form. Stored in `equipments` table (new nullable column `energy_meter_type TEXT`).

## Legrand Integration Changes

### Integration configuration

Energy polling is a **configurable parameter** of the Legrand integration, stored in integration settings:

```typescript
// In integration settings (settings table)
{
  "energy.enabled": true,  // Enable/disable energy polling
}
```

### Poller implementation (`pollEnergyMeters()`)

```typescript
private async pollEnergyMeters(): Promise<void> {
  const HALF_HOUR = 1800;
  const DATA_LAG_S = 25 * 60;  // Wait for Netatmo data stability
  const LOOKBACK_S = 6 * 3600; // 6h sliding window

  const nowTs = Math.floor(Date.now() / 1000);
  const lookbackStart = Math.floor((nowTs - LOOKBACK_S) / HALF_HOUR) * HALF_HOUR;

  for (let windowStart = lookbackStart; windowStart < nowTs; windowStart += HALF_HOUR) {
    const windowEnd = windowStart + HALF_HOUR;
    if (windowEnd > nowTs - DATA_LAG_S) break; // Data lag guard

    const windowWh = await this.queryEnergyWindow(windowStart, windowEnd);
    if (windowWh <= 0) continue;

    // sourceTimestamp = windowStart → aligned InfluxDB write
    this.deviceManager.updateDeviceData("netatmo_hc", meterName, {
      energy: windowWh,
    }, windowStart);
  }
}
```

### Backfill logic

On first setup (no `energy.legrand.lastBackfill` setting):

1. Fetch 6 months of bridge data using `scale=1hour`
2. Write directly to `sowel-energy-hourly` (bypass raw bucket — 7-day retention too short)
3. Process day by day with 200ms pause between API calls (rate limiting)
4. Store `energy.legrand.lastBackfill` timestamp in settings

**Important**: backfill bypasses the standard pipeline because raw retention is only 7 days. Historical hourly data is written directly to the pre-aggregated bucket. The `energy_sum_daily` task will then aggregate it into `sowel-energy-daily`.

## Tariff Configuration

### Settings keys

```
energy.tariff.schedule = JSON string
```

Schema:

```typescript
interface TariffSchedule {
  slots: TariffSlot[];
  defaultTariff: "hp" | "hc";
}

interface TariffSlot {
  start: string; // "HH:MM" (e.g., "22:30")
  end: string; // "HH:MM" (e.g., "06:30")
  tariff: "hp" | "hc";
  days?: number[]; // 0=Sunday..6=Saturday — if omitted, all days
}
```

Default (no config): all hours are HP.

### Classification

Applied at query time in the energy API. For each energy data point, the timestamp is checked against the tariff schedule to classify as HP or HC.

## API Endpoints

### `GET /api/v1/energy/history`

Query params:

- `period`: `day` | `week` | `month` | `year`
- `date`: ISO date (e.g., `2026-03-09`)

Resolution mapping:

- `day` → reads `sowel-energy-hourly` (hourly sums)
- `week` → reads `sowel-energy-hourly` (hourly sums)
- `month` / `year` → reads `sowel-energy-daily` (daily sums)

### `GET /api/v1/energy/status`

```typescript
interface EnergyStatus {
  available: boolean;
  hasSolar: boolean;
  sources: string[];
  lastDataAt: string | null;
  tariffConfigured: boolean;
}
```

## UI Components

### Equipment Detail: EnergyDataPanel

Displays 4 cumul tiles (hour/day/month/year) in 2x2 grid for `main_energy_meter` equipment type. Data comes from EnergyAggregator computed data (aliases: `energy_hour`, `energy_day`, `energy_month`, `energy_year`).

### `/energy` page

Period selectors: Jour / Semaine / Mois / Annee with date navigation.
Bar chart showing consumption per period unit (hour for day/week, day for month/year).

## File Changes

| File                                               | Change                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/shared/types.ts`                              | Add `sourceTimestamp?` to `device.data.updated` and `equipment.data.changed` events |
| `src/devices/device-manager.ts`                    | Accept optional `sourceTimestamp` in `updateDeviceData()`, propagate in event       |
| `src/equipments/equipment-manager.ts`              | Propagate `sourceTimestamp` from device event to equipment event                    |
| `src/history/history-writer.ts`                    | Use `sourceTimestamp` for `point.timestamp()` when present                          |
| `src/history/influx-client.ts`                     | Energy sum tasks with `-7h` lookback (hourly) and `-2d` (daily)                     |
| `src/equipments/energy-aggregator.ts`              | Query-based cumuls from InfluxDB (no incremental accumulation)                      |
| `src/integrations/netatmo-hc/netatmo-poller.ts`    | 6h sliding window, 25-min data lag guard, `sourceTimestamp`                         |
| `src/api/routes/energy.ts`                         | Energy API routes (reads pre-aggregated buckets)                                    |
| `src/api/server.ts`                                | Register energy routes                                                              |
| `ui/src/components/equipments/EnergyDataPanel.tsx` | Equipment detail cumul tiles                                                        |
| `ui/src/components/energy/EnergyBarChart.tsx`      | Bar chart component                                                                 |
| `ui/src/components/energy/EnergyPage.tsx`          | Main energy page                                                                    |
| `ui/src/components/energy/PeriodSelector.tsx`      | Period/date navigation                                                              |
