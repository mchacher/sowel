# Architecture — Spec 195

## Flow

```
clamp power (signed W) ──► equipment.data.changed (alias power)
  └─ PowerSubmeterIntegrator (flagged meter: countsLocalProduction)
       splitTrapezoidWh(prev, curr, dt) → consumedWh / producedWh
       flush per minute:
         energy     (consumed) → InfluxDB + equipment.data.changed  → slice, cumuls (unchanged path)
         production (produced) → InfluxDB + equipment.data.changed (sourceTimestamp = minute)
                                   └─ SelfConsumptionWriter: role "local" → added to the minute's solar
                                        autoconso / injection / household (existing arithmetic)
GET /energy/history  prod = production meter + every submeter's `production` series
Zone aggregator      signed power sum, unchanged (a zone shows −412 W while the panel exports)
UI Live              row = max(0, P); diagram solar += localProductionW (negative part of flagged meters)
```

## Data

### Migration `041_local_production.sql`

```sql
ALTER TABLE equipments ADD COLUMN local_production INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submeter_integrator_state ADD COLUMN pending_production_wh REAL NOT NULL DEFAULT 0;
```

### Types — `src/shared/types.ts`

`Equipment.localProduction?: boolean`, present only when set (like `separateSupply`, spec 179).

## Backend

### `src/equipments/metering.ts`

- `derivesEnergyFromPower(type, bindings)`: a submeter with a power binding and no energy binding.
  The integrator's own enrolment test now goes through it.
- `countsLocalProduction(eq, bindings)`: flag set, not `separateSupply`, power-derived. The single
  predicate read by the writer and the history route; mirrored in `ui/src/lib/metering.ts`.

### `src/api/routes/equipments.ts`

`PUT` accepts `localProduction`, validated on the resulting state (flag, type, `separateSupply`):

- `400 LocalProductionNotApplicable`: a `NON_SUBMETER_TYPES` type, or `separateSupply`.
- `400 LocalProductionNotPowerOnly`: setting the flag on a meter with its own energy counter.

### `src/energy/power-submeter-integrator.ts`

- `splitTrapezoidWh(prevW, currW, dtS)` (exported, pure): same-sign intervals go whole to one side;
  a sign change splits the trapezoid at the interpolated zero (two triangles).
- State gains `pendingProductionWh`, persisted with the rest.
- Flagged meter: consumed Wh → `pendingWh` / `cumulativeWh`, produced Wh → `pendingProductionWh`.
  Unflagged meter: `|P|` as before, with the existing one-time warning.
- `flushOne` writes each non-zero side through `writeDelta(eq, alias, wh, minute)`.

### `src/energy/self-consumption-writer.ts`

- Listens to `energy` and `production`; `resolveEquipmentRole(id, alias)` returns `local` for a
  `production` delta from a meter where `countsLocalProduction` holds.
- The minute bucket gains `localWh`; `autoconso = max(0, solarWh + localWh − injection)`.
- `carriedLocalWh`: local production of a minute with no grid tick moves into the next written minute.

### `src/api/routes/energy.ts`

`queryProductionPoints(…, localProducerIds)` adds `alias == "production"` for those ids to the Flux
filter. `localProducerIds` = every equipment outside `NON_SUBMETER_TYPES` without a device binding
aliased `production`, whatever its current flag: past production stays visible after unticking.

### `src/zones/zone-aggregator.ts`

No behaviour change; a comment records that a flagged meter stays in the signed sum.

## UI

- `ui/src/lib/metering.ts`: `derivesEnergyFromPower(eq)`, `countsLocalProduction(eq)`.
- `submeter-helpers.ts`: `readSubmeterReading` returns `max(0, P)` for a counting meter, `|P|`
  otherwise; `localProductionW(equipments, now)` sums the negative part of fresh readings, or `null`.
- `LiveEnergyPage.tsx`: `solarPower = meteredSolar + localSolar`.
- `MeteringParentPanel.tsx`: the "local production" checkbox, shown for a power-only meter on the
  house supply (or one already flagged); the separate-supply checkbox is disabled while it is ticked.
- i18n `equipments.metering.localProduction.{title,hint}` FR/EN.

## Files changed

| File                                                    | Change                                     |
| ------------------------------------------------------- | ------------------------------------------ |
| `migrations/041_local_production.sql`                   | two columns                                |
| `src/shared/types.ts`                                   | `Equipment.localProduction`                |
| `src/equipments/equipment-manager.ts`                   | row, mapping, update                       |
| `src/equipments/metering.ts`                            | shared predicates                          |
| `src/api/routes/equipments.ts` (+ test)                 | PUT field, two validation errors           |
| `src/energy/power-submeter-integrator.ts` (+ test)      | sign split, `production` delta             |
| `src/energy/self-consumption-writer.ts` (+ test)        | local solar, carry-over                    |
| `src/api/routes/energy.ts` (+ test)                     | `prod` reads submeters' `production`       |
| `src/zones/zone-aggregator.ts` (+ test)                 | comment; test pins the signed sum          |
| `ui/src/lib/metering.ts`, `ui/src/types.ts`, API client | mirror, field                              |
| `ui/src/components/energy/*` (+ test)                   | row clamp, Live diagram solar              |
| `ui/src/components/equipments/MeteringParentPanel.tsx`  | checkbox                                   |
| `ui/src/i18n/locales/{fr,en}.json`                      | keys                                       |
| docs                                                    | energy (user), API reference, architecture |
