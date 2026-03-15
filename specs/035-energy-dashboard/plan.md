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

Scope: tariff schedule configuration, HP/HC classification at write time, stacked bar chart, historical data migration.

### Backend — Types & Tariff Classifier

1. [ ] Add `TariffConfig`, `DaySchedule`, `TariffSlot`, `TariffPrices` types to `src/shared/types.ts`
2. [ ] Update `EnergyPoint` type: `{ time, hp, hc }` instead of `{ time, consumption }`
3. [ ] Update `EnergyTotals` type: add `total_hp`, `total_hc`
4. [ ] Create `src/energy/tariff-classifier.ts` — classify 30-min window → HP/HC split with prorata

### Backend — HistoryWriter integration

5. [ ] Inject `TariffClassifier` into `HistoryWriter`
6. [ ] On `energy` point write (category=energy, alias=energy): also write `energy_hp` and `energy_hc` points
7. [ ] Add `energy_hp` and `energy_hc` to `ALIAS_DEFAULTS_ON` (or handle via category default)

### Backend — API

8. [ ] Add tariff CRUD endpoints: `GET/PUT /api/v1/settings/energy/tariff`
9. [ ] Update `GET /api/v1/energy/history`: query `energy_hp`/`energy_hc`, return `{ time, hp, hc }`
10. [ ] Update `EnergyStatus` to include `tariffConfigured`

### UI — Stacked bars

11. [ ] Update `EnergyBarChart.tsx`: stacked bars HP (`#4F7BE8`) + HC (`#93B5F0`)
12. [ ] Update `EnergyPage.tsx`: legend with HP/HC totals below chart
13. [ ] Update `useEnergy.ts` store: new point format `{ time, hp, hc }`
14. [ ] Update `ui/src/api.ts`: tariff API functions

### UI — Settings

15. [ ] Create `TariffSettings.tsx`: time slot editor per day of week + prices
16. [ ] Integrate into Settings page (section Énergie)

### Migration

17. [ ] Create `scripts/energy/classify-hphc.ts`: classify existing historical data
18. [ ] Script must backup data before migration (or prompt user to backup)
19. [ ] Script reads tariff from settings, processes raw + hourly + daily buckets

### Validation

20. [ ] TypeScript compilation — zero errors (backend + frontend)
21. [ ] HP + HC totals = total consumption (consistency check)
22. [ ] Stacked bars render correctly for all periods (day/week/month/year)

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
