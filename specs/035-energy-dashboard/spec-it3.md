# IT3: Solar Production + Autoconsumption

## Summary

Add solar production tracking to the Energy Dashboard. A new Equipment type `energy_production_meter` stores total production (Wh/30min). Autoconsumption and grid injection are derived at query time from existing consumption and production data. A new Production chart displays stacked bars (autoconsumption + injection). The existing Consumption chart is later extended with an autoconsumption segment.

## Context

### What exists today

- Legrand poller fetches `sum_energy_buy_from_grid$1`, `$2`, and `sum_energy_self_consumption` from the Netatmo bridge API
- These 3 values are summed → total house consumption (Wh/30min), written as `energy` on the bridge Device
- User binds this Device data to an Equipment of type `main_energy_meter`
- Pipeline: Device → Equipment binding → HistoryWriter → InfluxDB → aggregation tasks
- `sum_energy_resell_to_grid` is available in the API but **not yet fetched**

### Key insight

`buy_from_grid$1 + $2 + self_consumption` = total house consumption (not just grid import). The API naming is misleading — `buy_from_grid` includes self-consumed solar energy.

## Design Decisions

### Production = self_consumption + resell_to_grid

The Legrand poller will also fetch `sum_energy_resell_to_grid` and compute:

```
production = self_consumption + resell_to_grid
```

This value is written as `energy_production` on the same bridge Device, with the same `sourceTimestamp` alignment.

### Same pipeline as consumption

The production data follows the exact same path:

- Poller writes `energy_production` data on Device
- User creates Equipment `energy_production_meter`, binds the Device data
- HistoryWriter writes to InfluxDB
- Aggregation tasks handle `energy_production` (no HP/HC classification for production)

### Autoconsumption and injection derived at query time

No separate storage needed. Given:

- `consumption` = total house consumption (from `main_energy_meter` Equipment)
- `production` = total solar production (from `energy_production_meter` Equipment)

Derived values:

- `autoconsumption = min(production, consumption)`
- `injection = max(0, production - consumption)`

### No HP/HC on production

Tariff classification (HP/HC) applies only to grid consumption, not to production.

### Virtual binding proposal at Equipment creation

When creating an `energy_production_meter` Equipment:

- User selects a physical Device (e.g., Legrand NLPC on solar circuit → provides real-time power)
- If Legrand integration is active with energy data available AND `energy_production` data exists on the bridge Device AND not already bound → propose to also bind this virtual energy data

## Equipment Types

Three `energyMeterType` values (mapped to EquipmentType):

| EquipmentType             | Label (fr)                         | Description                             |
| ------------------------- | ---------------------------------- | --------------------------------------- |
| `main_energy_meter`       | Compteur d'Énergie (principal)     | Total house consumption — singleton     |
| `energy_production_meter` | Compteur d'Énergie (production)    | Solar production — singleton            |
| `energy_meter`            | Compteur d'Énergie (sous-compteur) | Sub-meter (EV charger, heat pump, etc.) |

`energy_production_meter` is a singleton (only one allowed), like `main_energy_meter`.

## Data Model

### Production Equipment aliases

| Alias          | Unit | Category | Historized | Description                           |
| -------------- | ---- | -------- | ---------- | ------------------------------------- |
| `energy`       | Wh   | energy   | **yes**    | Production Wh per 30-min bucket       |
| `demand_30min` | W    | power    | no         | Average production power (energy × 2) |
| `energy_day`   | Wh   | energy   | no         | Today's cumulative production         |
| `energy_hour`  | Wh   | energy   | no         | Current hour cumulative               |
| `energy_month` | Wh   | energy   | no         | Current month cumulative              |
| `energy_year`  | Wh   | energy   | no         | Current year cumulative               |

Cumuls computed by EnergyAggregator (same as consumption).

### Energy History API response (updated)

```typescript
interface EnergyPoint {
  time: string;
  hp: number; // consumption HP (Wh)
  hc: number; // consumption HC (Wh)
  prod: number; // production total (Wh)
  autoconso: number; // min(prod, consumption) (Wh)
  injection: number; // max(0, prod - consumption) (Wh)
}
```

## UI

### Step A: Production chart (new)

- Second chart below consumption chart on `/energy` page
- Title: "Production solaire" (i18n)
- Stacked bars:
  - Autoconsommation: light green
  - Injection réseau: dark green
- Same period selector (shared with consumption chart)
- Legend below chart with totals
- Hidden if no `energy_production_meter` Equipment exists

### Step B: Autoconsumption in consumption chart

- Add autoconsumption as a 3rd stacked segment (light green) on top of HP/HC bars
- Total displayed = HP + HC + autoconso = total house consumption
- Legend updated with autoconso total

## Acceptance Criteria

- [ ] Poller fetches `sum_energy_resell_to_grid` alongside existing measures
- [ ] Poller computes production and writes `energy_production` on bridge Device with `sourceTimestamp`
- [ ] New Equipment type `energy_production_meter` (singleton)
- [ ] Auto-binding works for `energy_production_meter` (category `energy`)
- [ ] HistoryWriter writes production `energy` to InfluxDB (no HP/HC classification)
- [ ] EnergyAggregator computes production cumuls (hour/day/month/year)
- [ ] Energy API returns production + autoconso + injection data
- [ ] Production chart: stacked bars autoconso (light green) + injection (dark green)
- [ ] Production chart hidden when no production Equipment exists
- [ ] Consumption chart: autoconso segment added (Step B)
- [ ] Virtual binding proposal at `energy_production_meter` creation (Legrand)
- [ ] TypeScript compilation — zero errors
- [ ] i18n: all labels translated (fr + en)

## Edge Cases

- No solar panels → no `energy_production_meter` → production chart hidden, energy API returns only consumption
- Production Equipment exists but no data yet → production chart shows empty state
- Production > consumption in a 30-min window → injection > 0, autoconso = consumption
- Production = 0 (night) → autoconso = 0, injection = 0
- Legrand integration not active → no virtual binding proposal, user can still bind a physical Device
- Backfill: existing consumption data has no matching production → autoconso/injection = 0 for those periods

## Backfill Strategy

Production backfill is done incrementally across steps:

### Step A.1: Backfill 1 day

- Script to backfill production data for a single day (today or specified date)
- Validates the pipeline end-to-end before scaling up
- Uses same approach as `energy-backfill-today.ts`: query Netatmo API, write to InfluxDB

### Step A.2: Backfill 1 month

- Extend script to backfill a full month
- Validates aggregation (hourly/daily) over a longer period
- Compare production totals with Legrand dashboard

### Step C: Full backfill (6 months)

- Backfill up to 6 months of historical production data
- Same pattern as consumption backfill (`energy-backfill.ts`)
- Query Netatmo API with `scale=1hour`, write to `sowel-energy-hourly`

## Out of Scope

- Cost calculation from HP/HC prices (IT4)
- Multiple production meters (only one singleton for now)
- Per-circuit breakdown
