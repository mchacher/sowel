# Plan — Spec 134

Branch `feat/weather-daily-min-max`.

## Implementation steps

1. Migration `NNN_weather_temp_extremes.sql` (next sequential number).
2. `src/equipments/weather-temp-extremes-tracker.ts` — tracker class
   (event subscription, envelope logic, SQLite persistence, computed
   data provider, cleanup).
3. `weather-temp-extremes-tracker.test.ts` — full test plan below.
4. Wire in `src/index.ts` (instantiate + register provider + destroy on
   shutdown), mirroring `PoolWaterTempTracker`.
5. UI helper `findTempExtremes` in `weather-utils.ts` + unit tests.
6. `WeatherStationWidget` (EquipmentWidget.tsx), `MobileWidgetCard`,
   `WeatherPanel` — display wiring.
7. i18n FR/EN.
8. Validation: backend `tsc` + `eslint` + `vitest`; UI `tsc -b` +
   `eslint` + `vitest`.
9. Manual verification against prod-like data (dev instance or shadow):
   bind a weather station, observe envelope building, verify widgets.

## Test Plan

### Modules to test

- `weather-temp-extremes-tracker.ts` (backend — all business logic)
- `weather-utils.ts` `findTempExtremes` (UI helper — pure logic)

### Scenarios

| Module  | Scenario                                             | Expected                                          |
| ------- | ---------------------------------------------------- | ------------------------------------------------- |
| tracker | First temperature sample of the day                  | min = max = sample, row persisted                 |
| tracker | Lower then higher samples same day                   | min/max update independently                      |
| tracker | Sample with stored day != today (rollover)           | Envelope reset to the new sample                  |
| tracker | Restart: constructor reloads today's rows            | Envelope continues from persisted values          |
| tracker | Restart: persisted row from a past day               | Ignored/reset on next sample                      |
| tracker | Non-numeric / null value                             | Ignored, no row                                   |
| tracker | Equipment type != weather                            | Ignored                                           |
| tracker | Binding category not temperature/temperature_outdoor | Ignored                                           |
| tracker | Two temperature bindings (indoor + outdoor)          | Tracked independently per alias                   |
| tracker | `getComputedData` with no row for today              | No entries (empty array)                          |
| tracker | Equipment removed                                    | State + rows deleted, no further computed entries |
| helper  | Outdoor binding + both computed entries present      | `{min, max}` returned                             |
| helper  | Computed entries missing or non-numeric              | null                                              |
| helper  | Category not bound on the equipment                  | null                                              |

### Retro-compat

- Non-weather equipments: no behavioural change (guard tested).
- `computedData` consumers (pool, energy) untouched — additive provider.

## Tasks

- [x] P1 Migration
- [x] P2 Tracker + tests
- [x] P3 Wiring in index.ts
- [x] P4 UI helper + tests
- [x] P5 Widget/panel display + i18n
- [x] P6 Full validation green
- [ ] P7 Manual verification (pending — needs a live weather station; to be
      done on the shadow/demo instance or right after deploy)
