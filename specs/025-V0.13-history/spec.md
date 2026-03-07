# V0.13: Data History (InfluxDB)

## Summary

Add time-series data historization to Sowel using InfluxDB 2.x as an **optional** backend. Users configure which equipment data bindings to historize. Mini-charts appear inline in equipment/zone views, and a dedicated "Analyse" page enables deep exploration. The system has zero impact on Sowel core performance — writes are async, batched, and fire-and-forget.

## Reference

- Spec sections: sowel-spec.md §9 (InfluxDB Schema), §7.6 (History API), §10 (influx.ts), §12 (env vars)

## Acceptance Criteria

- [ ] Sowel starts and runs normally without InfluxDB configured
- [ ] Admin can configure InfluxDB connection in Settings (URL, token, org, bucket) with a "Test" button
- [ ] Admin can toggle historization per equipment data binding (checkbox in equipment detail)
- [ ] Historized data points are written to InfluxDB asynchronously with batch buffering
- [ ] API endpoint returns historical data with time range and aggregation support
- [ ] Equipment detail shows expandable time-series charts for historized bindings
- [ ] Zone/home cards show mini sparkline charts for key metrics (temperature, humidity, etc.)
- [ ] Dedicated "Analyse" page allows multi-metric overlay with time range selector
- [x] InfluxDB downsampling tasks auto-created (raw→hourly→daily)
- [ ] If InfluxDB goes down, Sowel continues operating — data points are silently dropped with warning logs

## Scope

### In Scope

- InfluxDB 2.x client wrapper with health check
- Async batch writer subscribing to `equipment.data.changed` events
- Per-binding historize toggle (stored in SQLite)
- History query API with time range + aggregation
- Recharts-based charting (sparklines + full charts)
- Mini-charts in equipment/zone cards
- Dedicated "Analyse" page with metric selector + time range picker
- InfluxDB connection settings in admin UI
- Docker-compose InfluxDB service
- Retention policies + downsampling configuration

### Out of Scope (deferred)

- AI-powered anomaly detection (V1.3)
- Customizable dashboard widgets (drag-and-drop)
- Data export to CSV/Excel (can be added later)
- Zone-level aggregated history writes (only equipment-level for now)
- InfluxDB alerting/thresholds

## Edge Cases

- InfluxDB not configured → all history features hidden in UI, no errors
- InfluxDB goes offline after config → warning logs, data points dropped, UI shows "history unavailable"
- Equipment deleted → InfluxDB data remains (no cascade delete — retention handles cleanup)
- Binding alias renamed → new series in InfluxDB, old data still queryable under old alias
- Very high data rate (e.g. power meter every second) → batch writer absorbs bursts, configurable flush interval
- No data points for a time range → empty chart with "No data" message
- Device offline → no data points written (no synthetic gaps)
- String/boolean values → stored as string field, charted as step/event markers
