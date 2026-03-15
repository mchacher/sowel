# Implementation Plan: 035 Energy Dashboard

## Approach: vertical slices

Each iteration delivers end-to-end value (backend + API + UI) for a specific feature. Each IT = separate branch (`feat/035a-*`, `feat/035b-*`, etc.), merged to main individually.

**Validation reference**: home.netatmo.com is the source of truth at every IT. Totals must match +-1%.

## Decisions

- **Data granularity**: 30-min windows (Netatmo actual resolution)
- **Poller**: 6h sliding window, 25-min data lag guard, `sourceTimestamp` for aligned writes
- **EnergyAggregator**: query-based (InfluxDB as single source of truth, no incremental accumulation)
- **InfluxDB tasks**: `-7h` lookback (hourly), `-2d` (daily) — aligned with poller window
- **Backfill**: 6 months of historical data on first run
- **Retention**: `sowel-energy-hourly` = 2 years, `sowel-energy-daily` = 10 years
- **`energyMeterType`**: deferred to IT3 (solar). IT1 finds energy Equipments by binding category `energy`

## IT1 — Total consumption (end-to-end) — `feat/035a-energy-consumption`

Scope: bridge-level consumption only. No solar, no HP/HC, no individual NLPCs.

### Backend — Pipeline + Poller

1. [x] Add `sourceTimestamp?: number` to `device.data.updated` and `equipment.data.changed` events in `types.ts`
2. [x] Accept optional `sourceTimestamp` in `DeviceManager.updateDeviceData()`, propagate in event
3. [x] Propagate `sourceTimestamp` through `EquipmentManager` (device event → equipment event)
4. [x] Use `sourceTimestamp` in `HistoryWriter` for `point.timestamp()` when present
5. [x] Create InfluxDB energy buckets + sum aggregation tasks in `influx-client.ts` (hourly: -7h, daily: -2d)
6. [x] Rewrite `pollEnergyMeters()` — 6h sliding window, 25-min data lag guard, `sourceTimestamp`
7. [x] Rewrite `EnergyAggregator` — query InfluxDB on trigger (debounced), no incremental state

### Backend — Not yet done

8. [ ] Backfill: on first run, fetch 6 months with `scale=1hour`, write to `sowel-energy-hourly`
9. [ ] Add `energy.enabled` integration setting for Legrand

### API

10. [x] Add energy types to `src/shared/types.ts`: `EnergyPoint`, `EnergyTotals`, `EnergyHistoryResponse`, `EnergyStatus`
11. [x] Create `src/api/routes/energy.ts` with `GET /api/v1/energy/status` and `GET /api/v1/energy/history`
12. [x] Register routes in `src/api/server.ts`

### UI

13. [x] Add energy API functions to `ui/src/api.ts`
14. [x] Create `ui/src/store/useEnergy.ts` — Zustand store
15. [x] Create `PeriodSelector.tsx` — Jour/Sem/Mois/Annee tabs + date navigation
16. [x] Create `EnergyBarChart.tsx` — Recharts BarChart
17. [x] Create `EnergyPage.tsx` — title + total kWh + chart + period selector
18. [x] Add `/energy` route to `App.tsx`
19. [x] Add "Energie" to `Sidebar.tsx`
20. [x] Create `EnergyDataPanel.tsx` — cumul tiles (hour/day/month/year) in equipment detail
21. [x] Add i18n keys (fr + en)

### Validation

22. [x] TypeScript compilation — zero errors (backend + frontend)
23. [ ] Compare daily totals with home.netatmo.com (+-1%)

---

## IT2 — HP/HC tariff classification — `feat/035b-energy-hphc`

Scope: add tariff schedule configuration, classify energy data as HP/HC at query time, stacked bar chart.

### Backend

1. [ ] Add `TariffSchedule`, `TariffSlot` types to `src/shared/types.ts`
2. [ ] Create `src/energy/tariff.ts` — classify timestamp → `hp` | `hc` given a schedule
3. [ ] Add tariff endpoints to `energy.ts`
4. [ ] Update `GET /api/v1/energy/history` — apply tariff classification to each point

### UI

5. [ ] Update `EnergyBarChart.tsx` — stacked bars: H.pleines + H.creuses + Autoconso
6. [ ] Add legend with totals per category
7. [ ] Add tariff configuration UI in Settings

---

## IT3 — Solar production + autoconsumption — `feat/035c-energy-solar`

Scope: add production virtual device, distinguish consumption/production Equipments.

### Backend

1. [ ] Add `energyMeterType` field to Equipment — DB migration + types
2. [ ] Create virtual device `legrand_energy_production` from bridge data
3. [ ] Backfill 6 months production data
4. [ ] Update energy API: derive autoconsumption at query time

### UI

5. [ ] Consumption chart with Autoconso stacking
6. [ ] Production chart (hidden if no solar)
7. [ ] `energyMeterType` dropdown in Equipment form

---

## IT4 — Individual NLPCs (per-circuit) — `feat/035d-energy-nlpc`

Scope: auto-detection of individual NLPCs, module-level polling, per-circuit energy data.

1. [ ] Implement `probeEnergyCapabilities()` — auto-detect individual vs aggregate NLPCs
2. [ ] Module-level polling for energy-capable NLPCs
3. [ ] Backfill 6 months per individual NLPC

---

## Dependencies

- IT1 standalone (mostly done)
- IT2 depends on IT1
- IT3 depends on IT2
- IT4 depends on IT1 (independent of IT2/IT3)
