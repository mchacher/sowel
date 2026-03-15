# Architecture: IT3 — Solar Production + Autoconsumption

## Data Model Changes

### types.ts

```typescript
// Add to EquipmentType union
| "energy_production_meter"

// Update EnergyPoint
interface EnergyPoint {
  time: string;
  hp: number;
  hc: number;
  prod: number;
  autoconso: number;
  injection: number;
}

// Update EnergyTotals
interface EnergyTotals {
  total_consumption: number;
  total_hp: number;
  total_hc: number;
  total_production: number;
  total_autoconso: number;
  total_injection: number;
}
```

### SQLite

No schema change. `energy_production_meter` is just a new value in the `type` column of `equipments` table.

### InfluxDB

Production data uses the same `equipment_data` measurement with:

- `alias=energy` on the production Equipment
- Same aggregation tasks (hourly/daily) — alias tag preserved, no task changes needed

## Backend Changes

### Netatmo Poller (`src/integrations/netatmo-hc/netatmo-poller.ts`)

1. Add `sum_energy_resell_to_grid` to `ENERGY_TYPES` query string
2. In `queryEnergyWindow()`: return both consumption and production
   - consumption = `values[0] + values[1] + values[2]` (unchanged)
   - production = `values[2] + values[3]` (self_consumption + resell_to_grid)
3. In `pollEnergyMeters()`: write `energy_production` data on Device alongside `energy`

```
queryEnergyWindow() returns { consumption: number, production: number }

pollEnergyMeters():
  // Existing: write consumption
  deviceManager.updateDeviceData("netatmo_hc", mainMeterName, { energy: windowWh }, windowStart)

  // New: write production (if > 0)
  deviceManager.updateDeviceData("netatmo_hc", mainMeterName, { energy_production: prodWh }, windowStart)
```

### Equipment Manager (`src/equipments/equipment-manager.ts`)

1. Add `"energy_production_meter"` to `VALID_TYPES`
2. Add singleton enforcement for `energy_production_meter` (same pattern as `main_energy_meter`)

### HistoryWriter

- No HP/HC classification for production data
- Production `energy` alias goes through standard write path (already works)

### EnergyAggregator (`src/equipments/energy-aggregator.ts`)

- Extend to also compute cumuls for `energy_production_meter` Equipment
- Same logic: query InfluxDB for hour/day/month/year sums

### Energy API (`src/api/routes/energy.ts`)

1. `findEnergyEquipmentId()` → also find `energy_production_meter`
2. `GET /api/v1/energy/history`:
   - Query both consumption and production from InfluxDB
   - Align timestamps
   - Compute `autoconso = min(prod, consumption)` and `injection = max(0, prod - consumption)` per point
   - Return updated `EnergyPoint[]` with all fields
3. `GET /api/v1/energy/status`:
   - Add `hasProduction: boolean` field

## Frontend Changes

### Types (`ui/src/types.ts`)

- Add `"energy_production_meter"` to `EquipmentType`
- Update `EnergyPoint`, `EnergyTotals` interfaces

### Store (`ui/src/store/useEnergy.ts`)

- Update to handle new point format (prod, autoconso, injection)

### Equipment UI

| File                     | Change                                                  |
| ------------------------ | ------------------------------------------------------- |
| `EquipmentForm.tsx`      | Add `energy_production_meter` option                    |
| `EquipmentCard.tsx`      | Add icon + label mapping                                |
| `bindingUtils.ts`        | Add data/order categories for `energy_production_meter` |
| `DeviceSelector.tsx`     | Add category filter                                     |
| `useEquipmentState.ts`   | Add `isEnergyMeter` check                               |
| `EquipmentsPage.tsx`     | Add to singleton types                                  |
| `HomePage.tsx`           | Add to singleton exclude                                |
| `ZoneEquipmentsView.tsx` | Add to energy group                                     |

### Energy UI

| File                 | Change                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| `EnergyPage.tsx`     | Add Production chart (Step A), autoconso in consumption chart (Step B) |
| `EnergyBarChart.tsx` | Support production mode (autoconso + injection stacking)               |
| `PeriodSelector.tsx` | No change (shared)                                                     |

### i18n

```json
// fr.json
"energy.production": "Production solaire",
"energy.autoconsumption": "Autoconsommation",
"energy.gridInjection": "Injection réseau",
"energy.totalProduction": "Production totale",
"equipments.type.energy_production_meter": "Compteur d'Énergie (production)"

// en.json
"energy.production": "Solar Production",
"energy.autoconsumption": "Self-consumption",
"energy.gridInjection": "Grid Injection",
"energy.totalProduction": "Total Production",
"equipments.type.energy_production_meter": "Energy Meter (production)"
```

### Colors

| Segment         | Color             | Usage                           |
| --------------- | ----------------- | ------------------------------- |
| HP (peak)       | `#4F7BE8`         | Consumption chart               |
| HC (off-peak)   | `#93B5F0`         | Consumption chart               |
| Autoconsumption | light green (TBD) | Production + Consumption charts |
| Injection       | dark green (TBD)  | Production chart                |

## File Changes Summary

| File                                            | Change                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `src/shared/types.ts`                           | Add `energy_production_meter`, update `EnergyPoint`, `EnergyTotals` |
| `src/integrations/netatmo-hc/netatmo-poller.ts` | Fetch `resell_to_grid`, write `energy_production`                   |
| `src/equipments/equipment-manager.ts`           | Add type + singleton                                                |
| `src/equipments/energy-aggregator.ts`           | Handle production cumuls                                            |
| `src/api/routes/energy.ts`                      | Production queries, autoconso/injection calc                        |
| `ui/src/types.ts`                               | Mirror backend type changes                                         |
| `ui/src/store/useEnergy.ts`                     | New point format                                                    |
| `ui/src/components/energy/EnergyPage.tsx`       | Production chart + autoconso segment                                |
| `ui/src/components/energy/EnergyBarChart.tsx`   | Production stacking mode                                            |
| `ui/src/components/equipments/*.tsx`            | Add `energy_production_meter` everywhere                            |
| `ui/src/i18n/locales/*.json`                    | New translation keys                                                |
