# Architecture: V0.13 Data History

## Design Principles

1. **Zero performance impact** — The history writer is a passive observer. It subscribes to events, buffers, and writes asynchronously. It never blocks the event loop or slows down the reactive pipeline.
2. **Optional dependency** — Sowel boots and operates fully without InfluxDB. History features are hidden when not configured.
3. **Per-binding granularity** — Users opt-in per equipment data binding. No unnecessary storage.
4. **Iterative UI** — Charts appear progressively: first inline in equipment detail, then sparklines everywhere, then a full analyse page.

## InfluxDB Data Model

### Measurement: `equipment_data`

| Type  | Name         | Description                                    |
| ----- | ------------ | ---------------------------------------------- |
| Tag   | equipmentId  | Equipment UUID                                 |
| Tag   | alias        | Binding alias (e.g. "temperature", "power")    |
| Tag   | category     | DataCategory (e.g. "temperature", "power")     |
| Tag   | zoneId       | Zone UUID (for zone-level queries)             |
| Tag   | type         | DataType ("number", "boolean", "enum", "text") |
| Field | value_number | Float value (for numeric categories)           |
| Field | value_string | String value (for boolean/enum/text)           |

### Retention Policies

| Policy | Duration | Resolution  | Created by     |
| ------ | -------- | ----------- | -------------- |
| raw    | 7 days   | As received | Default bucket |
| hourly | 90 days  | 1 hour      | InfluxDB task  |
| daily  | 5 years  | 1 day       | InfluxDB task  |

Downsampling tasks compute `mean`, `min`, `max`, `count` per window and write to dedicated buckets (`sowel-hourly`, `sowel-daily`).

## SQLite Changes

### Migration 020: `data_bindings` + `history_settings`

```sql
-- Add historize flag to existing data_bindings.
-- NULL = use category default, 1 = force ON, 0 = force OFF.
ALTER TABLE data_bindings ADD COLUMN historize INTEGER DEFAULT NULL;
```

**Historize resolution logic** (in HistoryWriter):

1. If `data_bindings.historize` is `1` → always historize
2. If `data_bindings.historize` is `0` → never historize
3. If `data_bindings.historize` is `NULL` → use category default

**Default resolution** (convention over configuration):

The HistoryWriter determines the effective historize state in order:

1. `data_bindings.historize = 1` → force ON
2. `data_bindings.historize = 0` → force OFF
3. `data_bindings.historize = NULL` → check alias defaults, then category defaults

**Alias defaults** (takes precedence over category — handles cases where category is `generic` but the data is semantically important):

| Alias    | Default | Rationale                                                                                                                                                                                              |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| setpoint | ON      | Thermostat setpoint — essential for consigne vs actual temperature analysis. Category is `temperature` in practice, but alias default is a safety net.                                                 |
| power    | ON      | HVAC ON/OFF state on thermostats (PAC, Poêle) — category is `generic` boolean, but knowing when heating ran is essential for energy analysis. Only writes on state transitions (deadband: any change). |

**Category defaults** (based on production audit of 88 bindings across 32 equipments):

| Category                      | Default | Rationale                   | Production examples                                                                                                                     |
| ----------------------------- | ------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| temperature                   | ON      | Key trend                   | THR temperature, PAC temperature/setpoint/outsideTemperature                                                                            |
| humidity                      | ON      | Key trend                   | THR humidity, Station Météo humidity                                                                                                    |
| pressure                      | ON      | Weather trend               | —                                                                                                                                       |
| luminosity                    | ON      | Day/night cycle             | PIRL illuminance                                                                                                                        |
| power                         | ON      | Consumption monitoring      | Power meters (number, W)                                                                                                                |
| energy                        | ON      | Cumulative, essential       | Energy meters (kWh)                                                                                                                     |
| rain                          | ON      | Weather trend               | Station Météo rain, sum_rain_1, sum_rain_24                                                                                             |
| wind                          | ON      | Weather trend               | Station Météo wind_strength, gust_strength, wind_angle, gust_angle                                                                      |
| co2, voc, noise               | ON      | Air quality, health         | —                                                                                                                                       |
| voltage, current              | ON      | Electrical diagnostic       | —                                                                                                                                       |
| shutter_position              | ON      | Opening tracking            | Volets position (×10 in production)                                                                                                     |
| battery                       | ON      | Anticipate replacements     | All sensors battery level (number, %). Note: `battery_low` (boolean) also matches but produces minimal data (2-4 points per lifecycle). |
| light_state                   | OFF     | Too frequent, recipe-driven | Spots state, Lumière state                                                                                                              |
| light_brightness              | OFF     | Noisy, recipe-driven        | Spots brightness, Appliques brightness                                                                                                  |
| light_color_temp, light_color | OFF     | Noisy, recipe-driven        | —                                                                                                                                       |
| motion                        | OFF     | Ultra-frequent binary       | PIR occupancy (×8 sensors in production)                                                                                                |
| contact_door, contact_window  | OFF     | Frequent, better as alerts  | —                                                                                                                                       |
| water_leak, smoke             | OFF     | Rare events, alert-driven   | —                                                                                                                                       |
| action                        | OFF     | Punctual events (buttons)   | Switch action (×3 in production)                                                                                                        |
| gate_state                    | OFF     | Rare, alert-driven          | —                                                                                                                                       |
| generic                       | OFF     | Unknown, manual opt-in      | Thermostat operationMode, fanSpeed, stoveState, etc. — can be enabled per-binding if desired                                            |

InfluxDB connection stored in `settings` table with prefix `history.`:

| Key                   | Example               |
| --------------------- | --------------------- |
| history.influx.url    | http://localhost:8086 |
| history.influx.token  | my-super-secret-token |
| history.influx.org    | sowel                 |
| history.influx.bucket | sowel                 |
| history.enabled       | true                  |

## Backend Architecture

### New Module: `src/history/`

```
src/history/
├── influx-client.ts      # InfluxDB 2.x client wrapper (connect, write, query, health)
├── history-writer.ts     # Event listener → batch write (fire-and-forget)
└── history-query.ts      # Query builder (time range, aggregation, multi-series)
```

### `InfluxClient` (influx-client.ts)

Wraps `@influxdata/influxdb-client` with:

- **connect(settings)** — Initialize client from settings
- **disconnect()** — Flush pending writes and close
- **isConnected()** — Health check (ping)
- **writePoint(point)** — Buffer a single data point
- **flush()** — Force flush buffered writes
- **query(flux)** — Execute a Flux query and return rows

Configuration:

- Batch size: 100 points (flush when buffer full)
- Flush interval: 5 seconds (flush even if buffer not full)
- Retry: 3 attempts with exponential backoff (1s, 2s, 4s)
- On persistent failure: log error, drop batch, continue

### `HistoryWriter` (history-writer.ts)

Subscribes to `equipment.data.changed` events:

```
equipment.data.changed
  → Is binding historized? (check in-memory cache)
  → Is InfluxDB configured & connected?
  → Deduplication: has value changed significantly? (deadband + min interval)
  → Build InfluxDB point (tags + fields)
  → Write to InfluxClient buffer (non-blocking)
```

**Caching**: Keeps an in-memory Set of historized binding IDs (refreshed on equipment changes) to avoid DB lookups on every event.

**Deduplication / Disk Protection**:

The writer maintains a `lastWritten` map per binding: `{ value, timestamp }`. A new point is written only if BOTH conditions are met:

1. **Minimum interval elapsed** (default: 30s, configurable globally via `history.minWriteInterval`)
   - Prevents high-frequency sensors from flooding the DB
   - A power meter reporting every second → max 2 points/minute instead of 60

2. **Value changed significantly** (deadband by category):
   | Category | Deadband | Example |
   |----------|----------|---------|
   | temperature | ±0.2 | 21.5→21.6 = skip, 21.5→21.8 = write |
   | humidity | ±1.0 | 52→53 = skip, 52→54 = write |
   | luminosity | ±5% | 500→520 = skip, 500→530 = write |
   | power | ±5W | 100→103 = skip, 100→108 = write |
   | energy | ±0.01 | Always write (cumulative) |
   | boolean/enum | any change | ON→ON = skip, ON→OFF = write |
   | shutter_position | ±2 | 50→51 = skip, 50→53 = write |
   | default | any change | Write on any value change |

   Deadband values are sensible defaults. Can be overridden per category in settings (`history.deadband.temperature`, etc.).

3. **Force write on state transitions**: regardless of deadband/interval, always write when:
   - Boolean changes (ON↔OFF, true↔false)
   - Enum changes (any state transition)
   - This ensures no state transitions are lost even with aggressive deduplication

**Disk usage estimation** (typical home, 50 historized bindings):

- With deduplication: ~14,400 points/day (~200 KB/day compressed)
- Raw 7 days: ~1.4 MB
- Hourly 90 days: ~1.6 MB
- Daily 5 years: ~1.4 MB
- **Total steady-state: ~5 MB** — negligible

**Value mapping**:

- `number` → `value_number` field (float)
- `boolean` → `value_string` field ("true"/"false") + `value_number` (1/0)
- `enum`/`text` → `value_string` field
- `null`/`undefined` → skip (don't write null points)

### `HistoryQuery` (history-query.ts)

Builds Flux queries for the API layer:

```typescript
interface HistoryQueryParams {
  equipmentId: string;
  alias: string;
  from: string; // ISO 8601 or relative (-24h, -7d)
  to?: string; // ISO 8601, defaults to now()
  aggregation?: "raw" | "1h" | "1d" | "auto"; // auto picks based on range
}

interface HistoryPoint {
  time: string; // ISO 8601
  value: number;
  min?: number; // Only for aggregated
  max?: number; // Only for aggregated
}
```

**Auto-aggregation logic**:

- Range ≤ 6h → raw data
- Range ≤ 7d → 1h aggregation (from hourly bucket)
- Range > 7d → 1d aggregation (from daily bucket)

## API Endpoints

### History Data

```
GET /api/v1/history/:equipmentId/:alias
  Query: from, to, aggregation
  Response: { points: HistoryPoint[], resolution: "raw"|"1h"|"1d" }

GET /api/v1/history/:equipmentId
  Response: { aliases: string[] }   // List historized aliases for an equipment
```

### History Status

```
GET /api/v1/history/status
  Response: {
    configured: boolean,
    connected: boolean,
    historizedBindings: number,
    stats: { pointsWritten24h: number, errors24h: number }
  }
```

### History Settings (admin only)

Settings are managed via existing `PUT /api/v1/settings` with `history.*` prefix keys. No new routes needed.

## Event Bus

No new event types needed. The history writer passively consumes:

- `equipment.data.changed` — write data point
- `equipment.created` / `equipment.updated` / `equipment.removed` — refresh historize cache
- `settings.changed` — reconnect InfluxDB if config changed

## UI Architecture

### Dependencies

Add to `ui/package.json`:

- `recharts` — React-native charting library (~200KB)

### New Components

```
ui/src/components/history/
├── TimeSeriesChart.tsx      # Full chart (Recharts LineChart + tooltip + legend)
├── Sparkline.tsx            # Tiny inline chart (no axes, no tooltip, 60×24px)
├── TimeRangeSelector.tsx    # Preset buttons (6h, 24h, 7d, 30d) + custom range
├── HistoryPanel.tsx         # Expandable chart panel for equipment detail
├── HistorySection.tsx       # Dedicated collapsible section in equipment detail
└── AnalyseView.tsx          # Full analyse page content
```

### New Store

```
ui/src/store/useHistory.ts
  - fetchHistory(equipmentId, alias, from, to) → HistoryPoint[]
  - fetchHistoryStatus() → status object
  - fetchHistorizeConfig(equipmentId) → binding historize states
  - setHistorize(equipmentId, bindingId, enabled | null) → toggle
  - cache: Map<cacheKey, { points, fetchedAt }> with 60s TTL
```

### Equipment Detail: "Historique" Section

A dedicated collapsible section in equipment detail (between controls and Devices section). Only visible when InfluxDB is configured.

```
┌─ Historique ──────────────────────────────┐
│                                            │
│  Température      [██ ON ]  (défaut)       │
│  Humidité         [██ ON ]  (défaut)       │
│  Luminosité       [██ ON ]  (modifié)      │
│  Mouvement        [  OFF ]  (défaut)       │
│  Batterie         [██ ON ]  (défaut)       │
│                                            │
└────────────────────────────────────────────┘
```

- Lists all data bindings of the equipment
- Each binding shows: alias name, toggle ON/OFF, "(défaut)" or "(modifié)" label
- Toggle has 3 states internally: NULL (use category default), 1 (force ON), 0 (force OFF)
- UI simplifies to ON/OFF toggle — shows "(défaut)" when matching category default, "(modifié)" when overridden
- Bindings currently historized (effective ON) are highlighted
- Section hidden entirely when InfluxDB not configured

### Integration Points

| Location                  | Component        | What                                                   |
| ------------------------- | ---------------- | ------------------------------------------------------ |
| Equipment detail page     | HistorySection   | Dedicated collapsible section with per-binding toggles |
| Equipment detail page     | HistoryPanel     | Expandable chart per historized binding (IT2)          |
| Home page: zone pills     | Sparkline        | 24h mini-chart for temperature, humidity (IT3)         |
| Home page: equipment card | Sparkline        | 24h mini-chart for primary metric (IT3)                |
| Settings page             | InfluxDB section | URL, token, org, bucket + test button                  |
| Sidebar                   | "Analyse" link   | New page /analyse (IT4)                                |
| Analyse page              | AnalyseView      | Multi-metric selector + full charts (IT4)              |

### Chart Design

**Sparkline** (inline, no interaction):

- Size: 60×24px
- Color: primary color, 1px stroke
- No axes, no labels, no tooltip
- Fill: primary-light with 20% opacity
- Data: last 24h, auto-aggregated

**Full chart** (in HistoryPanel and Analyse):

- Recharts ResponsiveContainer + LineChart
- X axis: time (auto-formatted by range)
- Y axis: value with unit
- Tooltip: value + timestamp
- Dark mode support via CSS variables
- Min/max range shown as light fill area (for aggregated data)

## Docker Compose

Add InfluxDB service:

```yaml
services:
  influxdb:
    image: influxdb:2.7
    container_name: sowel-influxdb
    restart: unless-stopped
    ports:
      - "8086:8086"
    volumes:
      - influxdb-data:/var/lib/influxdb2
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=sowel
      - DOCKER_INFLUXDB_INIT_PASSWORD=REDACTED_PASSWORD
      - DOCKER_INFLUXDB_INIT_ORG=sowel
      - DOCKER_INFLUXDB_INIT_BUCKET=sowel
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=sowel-dev-token

volumes:
  influxdb-data:
```

## File Changes Summary

| File                                   | Change                                          |
| -------------------------------------- | ----------------------------------------------- |
| `src/history/influx-client.ts`         | NEW — InfluxDB wrapper                          |
| `src/history/history-writer.ts`        | NEW — Event-driven batch writer                 |
| `src/history/history-query.ts`         | NEW — Flux query builder                        |
| `src/api/routes/history.ts`            | NEW — History REST endpoints                    |
| `src/api/server.ts`                    | Register history routes + pass deps             |
| `src/index.ts`                         | Instantiate HistoryWriter, pass to server       |
| `src/shared/types.ts`                  | Add HistoryPoint, HistoryQueryParams interfaces |
| `src/equipments/equipment-manager.ts`  | Expose historize flag in bindings               |
| `migrations/020_history.sql`           | Add historize column to data_bindings           |
| `docker-compose.yml`                   | Add InfluxDB service                            |
| `package.json`                         | Add `@influxdata/influxdb-client` dependency    |
| `ui/package.json`                      | Add `recharts` dependency                       |
| `ui/src/components/history/`           | NEW — All chart components                      |
| `ui/src/store/useHistory.ts`           | NEW — History data store                        |
| `ui/src/pages/AnalysePage.tsx`         | NEW — Analyse page                              |
| `ui/src/App.tsx`                       | Add /analyse route                              |
| `ui/src/components/layout/`            | Add Analyse to sidebar                          |
| `ui/src/pages/EquipmentDetailPage.tsx` | Add HistoryPanel + historize toggles            |
| `ui/src/components/home/`              | Add sparklines to cards and pills               |
| `ui/src/pages/SettingsPage.tsx`        | Add InfluxDB config section                     |
