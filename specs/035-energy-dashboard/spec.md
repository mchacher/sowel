# 035: Energy Dashboard

## Summary

Generic energy monitoring module for Sowel. Any integration providing energy data (consumption, solar production) can feed the module. The Energy Dashboard displays bar charts for consumption and production, with configurable tariff time slots (HP/HC) managed in Sowel — not dependent on the energy source.

Legrand Home+Control is the first provider. Data flows through the **standard pipeline** (Device → Equipment → HistoryWriter → InfluxDB), exactly like any other sensor.

## Reference

- Netatmo API: `getmeasure` on bridge with `scale=5min`
- **Actual data granularity**: 30-minute windows (2 buckets per hour), despite requesting 5-min scale
- Working measure types (bridge-level, using bridge as both device_id and module_id):
  - `sum_energy_buy_from_grid$1` — grid consumption HP tariff
  - `sum_energy_buy_from_grid$2` — grid consumption HC tariff
  - `sum_energy_self_consumption` — solar self-consumption
  - `sum_energy_resell_to_grid` — grid injection (solar surplus)
- Supported scales: `5min`, `30min`, `1hour`, `3hours`, `1day`
- API lag: ~20-25 min (last bucket available is ~20 min behind real time)

## Key Design Decisions

### 100% standard pipeline — no special energy storage

Energy data flows through the exact same pipeline as temperature, humidity, or any other sensor:

```
Integration poller → Device data update → Equipment (via binding) → HistoryWriter → InfluxDB (equipment_data)
```

No special `energy` measurement in InfluxDB. It's regular `equipment_data` with category `energy`. Energy data is bindable, historizable, aggregatable like any other data.

### `sourceTimestamp` for aligned writes

The pipeline supports an optional `sourceTimestamp` (epoch seconds) propagated from `updateDeviceData()` through to the HistoryWriter. For energy data, this is the aligned 30-min window start time. The HistoryWriter uses it as `point.timestamp()` instead of the default "now". This ensures clean, aligned data points in InfluxDB for proper hourly/daily aggregation.

### Poller: 6h sliding window with data lag guard

The Netatmo poller replays the last **6 hours** of 30-min windows on every poll cycle (~5 min). InfluxDB overwrites existing points (same tags + timestamp = idempotent). A **25-min data lag guard** ensures each window's data is stable before writing — no re-verification or delta corrections needed.

This design is:

- **Robust to restarts**: no state to restore, just replay the last 6h
- **Self-healing**: lost writes are recovered on the next poll cycle
- **Simple**: no `lastEnergyTimestamp` tracking, no re-verification logic

### EnergyAggregator: InfluxDB as single source of truth

Live cumuls (hour/day/month/year) are computed by querying InfluxDB on each energy event (debounced). No incremental in-memory accumulation, no high-water marks, no rollover logic. The query cost (~4 small queries every 5 min) is negligible.

### InfluxDB tasks aligned with poller window

The hourly aggregation task uses a **-7h lookback** (matching the poller's 6h window + margin). After a restart with a gap, the poller replays 6h of raw data and the task re-aggregates it. `to()` overwrites existing hourly points — idempotent.

### Generic Equipment model: "Compteur d'energie"

An Energy Meter Equipment has the same Data model regardless of the source (Legrand, Shelly, Zigbee):

| Alias          | Unit | Category | Historized | Description                                            |
| -------------- | ---- | -------- | ---------- | ------------------------------------------------------ |
| `energy`       | Wh   | energy   | **yes**    | Wh per 30-min bucket — the real measurement            |
| `demand_30min` | W    | power    | no         | Average power over last 30 min (`energy x 2`)          |
| `energy_day`   | Wh   | energy   | no         | Today's cumulative (EnergyAggregator → InfluxDB query) |
| `energy_hour`  | Wh   | energy   | no         | Current hour cumulative                                |
| `energy_month` | Wh   | energy   | no         | Current month cumulative                               |
| `energy_year`  | Wh   | energy   | no         | Current year cumulative                                |

Only `energy` (Wh per 30 min) is historized. Cumuls are computed live by the EnergyAggregator from InfluxDB.

Two Equipment types, distinguished by a `energyMeterType` field on the Equipment:

- **`consumption`** — Compteur Consommation — bound to NLPC Total, Shelly EM grid clamp, etc.
- **`production`** — Compteur Production — bound to NLPC Solaire, solar inverter, etc.

### Homogeneous across sources

| Source            | Raw data                         | Conversion to `energy` (Wh/30min) | `sourceTimestamp`  |
| ----------------- | -------------------------------- | --------------------------------- | ------------------ |
| Legrand (Netatmo) | Wh per 30-min window (cloud API) | Direct value                      | Window start time  |
| Shelly EM         | Cumulative Wh counter (MQTT)     | `delta = Wh_now - Wh_prev`        | Aligned to :00/:30 |
| Zigbee meter      | Cumulative Wh counter            | `delta = Wh_now - Wh_prev`        | Aligned to :00/:30 |

All sources produce the same `energy` data: Wh per aligned 30-min interval, written with `sourceTimestamp` for clean aggregation.

### HP/HC is a Sowel feature

Tariff time slots (Heures Pleines / Heures Creuses) are configured in Sowel settings, not derived from the energy source. This means:

- Any energy source benefits from HP/HC classification
- User can change tariff schedule without reconfiguring integration
- Works even if the source doesn't know about tariffs (e.g., Shelly)
- Classification is applied at query time — no data rewrite needed

### Legrand-specific: reverse calculation (calcul inverse)

Legrand provides HP/HC breakdown via `buy_from_grid$1` (HP) and `$2` (HC). We **do NOT store the HP/HC split** — we sum them back into a single total consumption. Sowel re-classifies HP/HC at query time based on the user's configured tariff schedule.

## Acceptance Criteria

### IT1 — Legrand energy collection via standard pipeline

- [x] Bridge-level consumption data polled with aligned 30-min windows
- [x] Data flows through standard pipeline with `sourceTimestamp`: Device → Equipment → HistoryWriter → InfluxDB
- [x] Raw points written at aligned timestamps (:00/:30) in InfluxDB
- [x] InfluxDB tasks `sowel-energy-sum-hourly` (-7h lookback) and `sowel-energy-sum-daily` (-2d lookback)
- [x] EnergyAggregator computes cumuls by querying InfluxDB (single source of truth)
- [x] Cumul tiles (hour/day/month/year) displayed in equipment detail view
- [x] 6h sliding window: robust to restarts, idempotent writes
- [x] 25-min data lag guard: no re-verification needed
- [ ] On first run, backfill up to 6 months of historical data
- [ ] Handles missing/null values gracefully
- [ ] Totals validated against home.netatmo.com (+-1%)

### IT2 — Energy API + tariff configuration

- [x] `GET /api/v1/energy/history` — returns energy time-series from InfluxDB (sum-aggregated buckets)
- [x] `GET /api/v1/energy/status` — detect energy data availability
- [ ] `GET /api/v1/settings/energy/tariff` — tariff schedule CRUD (HP/HC time slots)
- [ ] HP/HC classification applied at query time based on configured schedule

### IT3 — Energy Dashboard UI

- [x] New `/energy` page in sidebar, visible only if energy data exists
- [x] Bar chart with period selectors: Jour / Semaine / Mois / Annee
- [x] Date navigation with arrows
- [x] Total kWh displayed (2 decimal places)
- [ ] Stacked bars: Autoconso (green) + H. pleines (blue) + H. creuses (light blue)
- [ ] Production chart (hidden if no solar)
- [ ] Legend with totals per category

### IT4 (future) — Solar production + costs

- [ ] Virtual device `legrand_energy_production`
- [ ] `energyMeterType` field on Equipment (consumption/production)
- [ ] Cost calculation from HP/HC unit prices

## Scope

### In Scope

- Legrand bridge-level energy polling (30-min aligned windows)
- 6h sliding window with 25-min data lag guard
- `sourceTimestamp` through full pipeline for aligned InfluxDB writes
- EnergyAggregator querying InfluxDB (no incremental accumulation)
- InfluxDB sum-aggregation tasks (-7h hourly, -2d daily)
- 6-month historical backfill
- HP/HC tariff schedule in Sowel settings
- Energy REST API
- Bar chart UI with period selectors
- Equipment detail cumul tiles

### Out of Scope

- Per-NLPC breakdown in the Energy Dashboard UI
- Cost calculation (IT4)
- Other energy sources implementation (Shelly, Zigbee) — generic model supports them but implementation deferred
- Energy export (CSV, PDF)

## Validation Reference

**home.netatmo.com est la reference.** Les donnees affichees dans Sowel doivent etre comparees avec le dashboard Netatmo :

- Totaux journaliers doivent correspondre a +-1%
- Detail heure par heure doit correspondre barre par barre

## Edge Cases

- InfluxDB not configured → Energy page shows "Configure InfluxDB in Settings" message
- No energy data yet → Energy page not visible in sidebar
- No solar panels → Production chart hidden, self_consumption always 0
- Legrand API returns null for some buckets → skip those points, don't write 0
- Rate limiting (Netatmo 429) → backfill with delays, retry on next poll
- Backend restart → poller replays 6h sliding window, InfluxDB overwrites (idempotent)
- Backend down for <6h → poller fills the gap automatically on restart
- Backend down for >6h → gap in raw data, but hourly task (-7h) re-aggregates what's available
- Tariff schedule not configured → all consumption shown as "Heures Pleines" (default)
- Tariff schedule changed → no need to rewrite InfluxDB data (classification is at query time)
