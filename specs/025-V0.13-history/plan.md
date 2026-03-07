# Implementation Plan: V0.13 Data History

## Iterative Delivery

Each iteration is independently deployable and delivers visible value to the user. No iteration depends on a later one. The user can stop at any iteration and have a fully functional system.

---

## Iteration 1: InfluxDB Foundation + Settings UI

**Goal**: Wire up InfluxDB client, store config, test connection from UI.

**Backend**:

- [ ] Add `@influxdata/influxdb-client` to package.json
- [ ] Create `src/history/influx-client.ts` — connect, disconnect, health check, writePoint, flush, query
- [ ] Create `src/history/history-writer.ts` — subscribe to `equipment.data.changed`, buffer writes, fire-and-forget flush
- [ ] Migration `020_history.sql` — add `historize` column to `data_bindings`
- [ ] Update `EquipmentManager.addDataBinding()` to accept optional `historize` flag
- [ ] Add `setHistorize(equipmentId, bindingId, enabled)` method to EquipmentManager
- [ ] Expose historize status in `getDataBindingsWithValues()`
- [ ] Create `src/api/routes/history.ts` — `GET /api/v1/history/status`, `POST /api/v1/history/test-connection`
- [ ] Register history routes in `server.ts`
- [ ] Wire HistoryWriter in `index.ts` (instantiate after EquipmentManager, before server)

**Deployment / InfluxDB Setup**:

- [ ] Update `docker-compose.yml` with InfluxDB 2.7 service (auto-init: org, bucket, admin token)
- [ ] Auto-setup on first connect: InfluxClient verifies/creates required buckets (sowel, sowel-hourly, sowel-daily) with correct retention policies
- [ ] Test connection endpoint validates: ping OK + bucket exists + write permission
- [ ] Graceful startup: if InfluxDB is in docker-compose but slow to start, HistoryWriter retries connection silently (no crash)
- [ ] Add `history.enabled` setting — master switch (default: false until configured)

**Frontend**:

- [ ] Settings page: InfluxDB configuration section (URL, token, org, bucket)
- [ ] "Test Connection" button with success/error feedback (shows: ping, bucket check, write test)
- [ ] Equipment detail: dedicated collapsible "Historique" section with per-binding ON/OFF toggles (shows category default vs overridden)
- [ ] Connection status indicator (health dot) in settings
- [ ] When not configured: history UI sections hidden (no empty states cluttering the UI)

**Testing**:

- [ ] Unit test: HistoryWriter correctly filters by historize flag
- [ ] Unit test: HistoryWriter batch buffering (flush on size + interval)
- [ ] Unit test: HistoryWriter graceful degradation when InfluxDB down
- [ ] Unit test: Deduplication (deadband + min interval + force on state transition)
- [ ] Manual: `docker-compose up` → configure in Settings → test connection → enable historize on a binding → verify points in InfluxDB UI (localhost:8086)

**Deliverable**: Admin can deploy InfluxDB via docker-compose, configure the connection in Settings, enable per-binding historization, and verify data is being recorded.

---

## Iteration 2: History API + Equipment Charts

**Goal**: Query historical data and display charts in equipment detail.

**Backend**:

- [ ] Create `src/history/history-query.ts` — Flux query builder with time range + aggregation
- [ ] Add `GET /api/v1/history/:equipmentId/:alias` endpoint
- [ ] Add `GET /api/v1/history/:equipmentId` endpoint (list historized aliases)
- [ ] Auto-aggregation logic (raw ≤6h, hourly ≤7d, daily >7d)

**Frontend**:

- [ ] Add `recharts` to ui/package.json
- [ ] Create `ui/src/store/useHistory.ts` — fetch + cache with 60s TTL
- [ ] Create `ui/src/components/history/TimeSeriesChart.tsx` — LineChart with tooltip, responsive
- [ ] Create `ui/src/components/history/TimeRangeSelector.tsx` — 6h/24h/7d/30d presets
- [ ] Create `ui/src/components/history/HistoryPanel.tsx` — expandable panel per binding
- [ ] Integrate HistoryPanel in EquipmentDetailPage (below sensor data, for historized bindings)
- [ ] Dark mode support for charts (use CSS variables)

**Testing**:

- [ ] Unit test: query builder generates correct Flux for each aggregation level
- [ ] Manual: open equipment detail → see 24h chart for temperature → switch to 7d → data loads

**Deliverable**: Users see time-series charts in equipment detail for each historized binding.

---

## Iteration 3: Sparklines + Home Integration

**Goal**: Mini-charts appear inline in home page cards and zone pills.

**Frontend**:

- [ ] Create `ui/src/components/history/Sparkline.tsx` — 60×24px, no axes, primary color fill
- [ ] Home page: zone aggregation pills — sparkline next to temperature/humidity values
- [ ] Home page: equipment cards — sparkline for primary numeric metric
- [ ] Sparkline data: 24h auto-aggregated, fetched on mount, cached per session
- [ ] Lazy loading: sparklines fetch only when visible (IntersectionObserver or scroll into view)
- [ ] Loading state: skeleton animation (no spinner)

**Backend**:

- [ ] Add `GET /api/v1/history/sparkline/:equipmentId/:alias` — optimized endpoint returning last 24h as ~48 points (30min aggregation)

**Testing**:

- [ ] Manual: home page loads → sparklines appear next to temperature values
- [ ] Performance: page load time unaffected when InfluxDB has no data

**Deliverable**: At-a-glance trends visible everywhere without clicking into equipment detail.

---

## Iteration 4: Analyse Page

**Goal**: Dedicated analysis page for deep data exploration.

**Frontend**:

- [ ] Create `ui/src/pages/AnalysePage.tsx`
- [ ] Add `/analyse` route in App.tsx
- [ ] Add "Analyse" entry in sidebar (BarChart3 icon from Lucide, between Calendar and Admin section)
- [ ] Create `ui/src/components/history/AnalyseView.tsx`:
  - Zone selector (tree dropdown)
  - Equipment selector (filtered by zone)
  - Metric/alias multi-selector (checkboxes)
  - TimeRangeSelector (reuse from iteration 2)
  - Multi-series overlay chart (different colors per series)
  - Legend with color + equipment name + alias
- [ ] Compare mode: overlay metrics from different zones on same chart
- [ ] Chart interaction: zoom (drag to select range), pan
- [ ] Responsive layout: full width on all screen sizes

**Testing**:

- [ ] Manual: select 2 zones → compare temperature → zoom into spike

**Deliverable**: Power users can explore and compare metrics across zones and time ranges.

---

## Iteration 5: Retention & Downsampling

**Goal**: Automatic data lifecycle management.

**Backend**:

- [x] Create InfluxDB downsampling tasks on first connection (or via setup endpoint):
  - Task `downsample-hourly`: aggregate raw → `sowel-hourly` bucket (mean, min, max per 1h)
  - Task `downsample-daily`: aggregate hourly → `sowel-daily` bucket (mean, min, max per 1d)
- [x] Bucket retention: raw=7d, hourly=90d, daily=5y (configurable in settings)
- [x] `GET /api/v1/history/retention` returns bucket retention + task status
- [x] HistoryQuery auto-selects bucket based on time range (with fallback to raw)

**Frontend**:

- [x] Settings: retention policy display (read-only, shows current bucket retention + task status)
- [ ] Settings: storage usage indicator (total points, approximate disk usage) — deferred

**Testing**:

- [ ] Manual: wait for downsampling task to run → query daily bucket → verify data

**Deliverable**: Data is automatically managed — old raw data pruned, aggregated data kept long-term.

---

## Iteration 6 (Future): Data Export + Advanced

**Goal**: Export capabilities and advanced features.

- [ ] CSV export from Analyse page (button → download)
- [ ] Pinnable charts on home dashboard
- [ ] Threshold lines on charts (e.g. lux threshold from recipe config)
- [ ] Event markers on timeline (mode changes, recipe overrides)

---

## Dependencies

- Sowel V0.12 (Computed Data) is NOT a prerequisite — history can be built independently
- InfluxDB 2.7+ (Docker image: `influxdb:2.7`)
- npm: `@influxdata/influxdb-client` (backend)
- npm: `recharts` (frontend)

## Risk Mitigation

| Risk                                  | Mitigation                                                   |
| ------------------------------------- | ------------------------------------------------------------ |
| InfluxDB adds deployment complexity   | Docker-compose preconfigured, zero-config init               |
| High write volume impacts performance | Batch writer with configurable buffer, fire-and-forget       |
| InfluxDB downtime loses data          | Acceptable for home automation — warning log, auto-reconnect |
| Large query results slow UI           | Auto-aggregation, max 500 points per response, pagination    |
| Recharts bundle size                  | Tree-shakeable, only import LineChart + Tooltip              |

## Manual Testing Checklist

- [ ] Start Sowel without InfluxDB → no errors, history features hidden
- [ ] Configure InfluxDB in Settings → test connection succeeds
- [ ] Enable historize on a temperature binding → data appears in InfluxDB
- [ ] Open equipment detail → chart shows last 24h of temperature
- [ ] Switch to 7d range → hourly aggregation loads
- [ ] Home page sparklines show trends
- [ ] Analyse page: overlay temperature from 2 zones
- [ ] Kill InfluxDB → Sowel continues running, warning in logs
- [ ] Restart InfluxDB → writes resume automatically
