# Implementation Plan — Spec 160

Two repos. Plugin first, since the core has nothing to consume without it, but
they are independent at runtime: the core simply publishes no curve until the
irradiance series appears.

## Slices

### Slice A — Plugin 2.2.0: the irradiance series

- A.1 — Fetch `direct_radiation`, `diffuse_radiation` and `temperature_2m`
  hourly over 120 points, on the existing poll.
- A.2 — Publish `irradiance_120h` as one `json` data point, category
  `solar_radiation`.
- A.3 — Degrade like the rest: a failed hourly call costs the series, never the
  daily forecast.
- A.4 — Release, then the registry `sha256` bump (spec 089).

### Slice B — Core: geometry and model, pure

- B.1 — `solar-geometry.ts`: `solarPosition` over `suncalc`, `toDni` with the
  low-sun guard, `planeOfArray` with per-plane clipping.
- B.2 — `pv-model.ts`: `fitModel`, `predict`, `refitGainOnly`.
- B.3 — `SolarProfile` validation, shared between the API and the UI.

### Slice C — Core: types, storage, wiring

- C.1 — `SolarPlane` / `SolarProfile` in `types.ts`, `Equipment.solarProfile`.
- C.2 — Migration for `equipments.solar_profile`, and for `pv_forecast_model`.
- C.3 — `equipment-manager` reads and writes the column.
- C.4 — `pv-forecaster.ts`: nightly refit, irradiance subscription, curve
  computation, InfluxDB persistence, computed-data provider.
- C.5 — Wire into `src/index.ts`.

### Slice D — Core: API

- D.1 — `GET /api/v1/energy/pv-forecast/:equipmentId`.
- D.2 — `POST /api/v1/energy/pv-forecast/:equipmentId/recalibrate`.
- D.3 — `PUT` of the solar profile through the existing equipment update route.

### Slice E — UI

- E.1 — `SolarProfileForm`: planes, cardinal shortcuts, validation (FR9).
- E.2 — `PvForecastPanel`: curve to J+5, forecast against actual on past days,
  rolling accuracy, recalibrate action.
- E.3 — Wire both into `EquipmentDetailPage` for `energy_production_meter`.
- E.4 — i18n, both languages.

## Test Plan

### Modules to test

- `src/energy/pv/solar-geometry.ts`
- `src/energy/pv/pv-model.ts`
- The `SolarProfile` validator
- Plugin: the irradiance slice of the payload builder

`pv-forecaster.ts` is not unit tested: it is timers, InfluxDB and subscription
wiring, the same line the project draws elsewhere. Its logic lives in the two
pure modules above.

### Scenarios

| Module         | Scenario                                        | Expected                                                                                       |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| solar-geometry | `solarPosition` at solar noon, 21 June, 45 N    | Azimuth ~180 deg, elevation ~68 deg                                                            |
| solar-geometry | `solarPosition` morning vs afternoon            | Azimuth east of south before noon, west after                                                  |
| solar-geometry | `toDni` with sun at zenith                      | Returns the horizontal value unchanged                                                         |
| solar-geometry | `toDni` with sun at 30 deg                      | Returns roughly twice the horizontal value                                                     |
| solar-geometry | `toDni` below the guard elevation               | Returns 0, never divides by a vanishing sine                                                   |
| solar-geometry | `planeOfArray`, one south plane, sun due south  | Close to DNI plus the diffuse share                                                            |
| solar-geometry | `planeOfArray`, sun behind the plane            | Diffuse only, never a negative direct contribution                                             |
| solar-geometry | `planeOfArray`, east/west split at sunrise      | East plane carries it; **strictly greater** than the same total declared as one averaged plane |
| solar-geometry | `planeOfArray`, flat plane (tilt 0)             | Diffuse coefficient is 1, direct scales with sin(elevation)                                    |
| solar-geometry | `planeOfArray` with an empty plane list         | Returns 0 rather than dividing by a zero total                                                 |
| pv-model       | `fitModel` on a clean synthetic day             | Recovers the injected gain within a few percent                                                |
| pv-model       | `fitModel` below the sample floor               | `null`, not a model fitted on noise                                                            |
| pv-model       | `fitModel` with a sample above peak power       | Sample excluded, the fit unchanged by it                                                       |
| pv-model       | `fitModel` with an all-night window             | `null`                                                                                         |
| pv-model       | `predict` at 25 C versus 35 C                   | Lower at 35 C, by about 4 %                                                                    |
| pv-model       | `predict` with zero POA                         | 0                                                                                              |
| pv-model       | `predict` clips at the declared peak            | Never above the array's nameplate                                                              |
| pv-model       | `refitGainOnly`                                 | `gain` moves, `shape` byte-identical                                                           |
| pv-model       | `refitGainOnly` on a +40 % array                | New gain within a few percent of the measured 1.4 factor                                       |
| pv-model       | `refitGainOnly` below the sample floor          | Old gain kept rather than replaced by a noisy one                                              |
| forecaster     | Profile saved with a different total peak power | `gain` re-estimated, `shape` untouched                                                         |
| forecaster     | Profile saved with the same total peak power    | No reset; a tilt-only edit keeps the fit                                                       |
| validator      | Tilt 91, or -1                                  | Rejected, field named                                                                          |
| validator      | Azimuth 361                                     | Rejected, field named                                                                          |
| validator      | Peak power 0 or negative                        | Rejected                                                                                       |
| validator      | Empty plane list                                | Treated as absent, not as an invalid profile                                                   |
| validator      | Two valid planes                                | Accepted                                                                                       |
| validator      | Each of the eight cardinals                     | Sets the expected azimuth, N is 0 and S is 180                                                 |
| plugin         | 120 hourly points parsed into the series        | `hours` has 120 entries with direct, diffuse and temp                                          |
| plugin         | Hourly call fails                               | Series absent, the daily forecast still published                                              |

### Fixtures

The irradiance payload captured from the live API on 2026-08-25 (120 points,
4.4 KB), committed alongside the plugin's existing fixtures.

## Validation Plan

- `npx tsc --noEmit`, `cd ui && npx tsc -b --noEmit` — zero errors
- `npx vitest run` (core) and `npm test` (plugin) — all green
- `npx eslint src/ --ext .ts` and `cd ui && npx eslint .` — zero errors
- Replay the 92 archived days through `fitModel` and `predict` offline and check
  the daily MAE lands near the 1.19 kWh measured during the study. A model that
  scores materially worse means the port lost something the analysis had.
- Install on the **shadow** instance, never on prod, declare the reference
  array (35 deg, south, 4000 Wc) and verify the curve, the panel and the
  recalibrate action.

## Out of this plan

- Consumption by the arbiter (its phases 5 and 6 do not exist)
- Per-panel health and fault attribution (planning doc section 7)
- Sub-hourly nowcasting
