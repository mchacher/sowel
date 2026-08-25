# Architecture — Spec 160

Two repos. The plugin publishes irradiance, the core turns it into production.

The split is the one spec 053 imposes: **the core cannot fetch Open-Meteo
itself** without becoming an integration. So the hourly irradiance series is the
deferred half of spec 159, shipped here as plugin **2.2.0**, and everything that
converts it into a production forecast is core work.

## Flow diagram

```
weather-forecast plugin 2.2.0, every poll
  │  hourly direct_radiation, diffuse_radiation, temperature_2m, 120 points
  ▼
device data  irradiance_120h   (type "json", category "solar_radiation")
  │            read straight off the DeviceManager — no binding, no equipment
  ▼  device.data.updated
PvForecaster (core)
  │
  ├─ solar position ..... suncalc getPosition(), already a dependency
  ├─ POA ................ per declared plane, clipped, weighted by peak power
  ├─ gain, shape(h) ..... refit nightly, rolling 45 days, from InfluxDB
  │                       production history
  └─ P(h) = gain · shape(h) · POA · (1 + γ(T−25))
        │
        ├──> computed data on the production equipment
        │      pv_forecast_today_kwh, pv_forecast_tomorrow_kwh,
        │      pv_forecast_curve (json), pv_forecast_accuracy
        │
        └──> InfluxDB  measurement "pv_forecast"
               tags: equipmentId, leadBucket        2-year retention
               field: watts
                     │
                     ▼  once the hour has passed
               compared with equipment_data production -> accuracy
```

Downstream is untouched: computed data reaches the UI through the existing
`EquipmentWithDetails.computedData`, no new event, no WebSocket change.

## Components

### New: `src/energy/pv/solar-geometry.ts`

Pure. Solar position and plane-of-array irradiance.

```ts
export function solarPosition(
  when: Date,
  lat: number,
  lon: number,
): { elevationRad: number; azimuthRad: number };

/** Horizontal direct radiation to normal, guarded at low sun. */
export function toDni(directHorizontal: number, elevationRad: number): number;

export function planeOfArray(
  planes: readonly SolarPlane[],
  dni: number,
  diffuse: number,
  sun: { elevationRad: number; azimuthRad: number },
): number;
```

`planeOfArray` clips each plane separately with `max(0, cos theta)` before
summing, weighted by peak power. That clipping is the whole reason a plane list
is not equivalent to a single averaged plane.

### New: `src/energy/pv/pv-model.ts`

Pure. The fit and the prediction.

```ts
export interface PvModel {
  gain: number;
  /** Local hour -> efficiency coefficient. */
  shape: Record<number, number>;
  fittedAt: string;
  samples: number;
}

export function fitModel(samples: readonly PvSample[]): PvModel | null;
export function predict(model: PvModel, poa: number, tempC: number): number;
export function refitGainOnly(model: PvModel, samples: readonly PvSample[]): PvModel;
```

`fitModel` returns `null` below the minimum sample count rather than a model
fitted on noise. `refitGainOnly` is what a declared capacity change and the
manual action both call: the shape stays on its slow window, because it was
measured identical before and after a real +1 kW addition.

There is deliberately no step detector here. The undeclared loss — an inverter
dropping, a panel failing — is the absolute performance ratio of the health
feature (planning doc section 7), which watches the same signal for that
purpose. Two detectors on one ratio would disagree at the edges.

### New: `src/energy/pv/pv-forecaster.ts`

The stateful piece. Owns the nightly refit, subscribes to
`device.data.updated` for the irradiance series, writes the curve to InfluxDB
and registers a computed-data provider.

**The irradiance series is read straight off the `DeviceManager`, with no data
binding and no equipment.** Bindings exist to attach device data to something a
household looks at; this series is a computation input nobody wants on a card.
The forecaster looks for a device data point of category `solar_radiation` and
type `json`, whichever integration publishes it, so a future weather plugin can
serve it without a code change here.

This matters for more than tidiness: a binding would have to be created by hand
after the plugin update, which is exactly the friction reported in issue #707.
The only thing this feature asks of the owner is the array declaration, and that
ask is deliberate.

Follows `WeatherTempExtremesTracker` (spec 134) for the provider registration
and `EnergyAggregator` for the hour-aligned timer.

### New: `migrations/0NN_pv_forecast_model.sql`

```sql
CREATE TABLE IF NOT EXISTS pv_forecast_model (
  equipment_id      TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  gain              REAL NOT NULL,
  shape             TEXT NOT NULL,   -- JSON, local hour -> coefficient
  fitted_at         TEXT NOT NULL,
  samples           INTEGER NOT NULL,
  -- Total peak power the fit was made against. A profile saved with a different
  -- total is what triggers a gain-only refit (FR7).
  fitted_peak_wc    REAL NOT NULL,
  gain_reset_at     TEXT             -- last declared change or manual recalibration
);
```

One row per equipment. `ON DELETE CASCADE` is what makes the spec's "equipment
deleted" edge case free.

### Changed: `src/shared/types.ts`

```ts
export interface SolarPlane {
  tiltDeg: number;
  azimuthDeg: number;
  peakWc: number;
}
export interface SolarProfile {
  planes: SolarPlane[];
}

export interface Equipment {
  // ...
  /** Spec 160 — declared array geometry. Presence enables the PV forecast. */
  solarProfile?: SolarProfile;
}
```

Stored as JSON in a new `equipments.solar_profile` column, exactly as
`energy_profile` is.

### Changed: `src/core/influx-client.ts`

A `pv_forecast` measurement written at `ENERGY_RETENTION.hourly` (2 years). It
reuses the energy-hourly bucket rather than adding a fourth: same retention,
same lifecycle, and the measurement name keeps it separable.

### Changed: `src/api/routes/energy.ts`

| Method | Route                                                 | Purpose                                   |
| ------ | ----------------------------------------------------- | ----------------------------------------- |
| GET    | `/api/v1/energy/pv-forecast/:equipmentId`             | curve, model provenance, rolling accuracy |
| POST   | `/api/v1/energy/pv-forecast/:equipmentId/recalibrate` | force a `gain` refit (FR7)                |

Both admin-only, following the arbiter routes.

### Changed: UI

| File                                                | Change                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `ui/src/components/equipments/PvForecastPanel.tsx`  | **new** — curve, forecast against actual, accuracy, recalibrate action |
| `ui/src/components/equipments/SolarProfileForm.tsx` | **new** — declare the planes                                           |
| `ui/src/pages/EquipmentDetailPage.tsx`              | render both for `energy_production_meter`                              |
| `ui/src/i18n/locales/{en,fr}.json`                  | copy                                                                   |

The panel follows `EnergyDataPanel`, already rendered for this equipment type.
Charts follow the existing energy charts, Recharts, no new dependency.

### Plugin: `sowel-plugin-weather-forecast` 2.2.0

One new data point, the deferred half of spec 159:

| Field      | Value                                                                |
| ---------- | -------------------------------------------------------------------- |
| Data point | `irradiance_120h`                                                    |
| Type       | `json`, category `solar_radiation`                                   |
| Payload    | `issuedAt`, `model`, and `hours` as `[{ t, direct, diffuse, temp }]` |

`direct_radiation` and `diffuse_radiation` separately, never just
`shortwave_radiation`: the split carries most of the signal. AROME HD carries
none of the three, so the series comes from `meteofrance_arome_france` or any
global model. 120 points, about 4.4 KB.

## Files changed

| Domain | File                                          | Change                                                 |
| ------ | --------------------------------------------- | ------------------------------------------------------ |
| Types  | `src/shared/types.ts`                         | `SolarPlane`, `SolarProfile`, `Equipment.solarProfile` |
| DB     | `migrations/0NN_pv_forecast_model.sql`        | **new**                                                |
| DB     | `migrations/0NN_equipments_solar_profile.sql` | **new** — the column                                   |
| Core   | `src/energy/pv/solar-geometry.ts`             | **new**                                                |
| Core   | `src/energy/pv/pv-model.ts`                   | **new**                                                |
| Core   | `src/energy/pv/pv-forecaster.ts`              | **new**                                                |
| Core   | `src/core/influx-client.ts`                   | `pv_forecast` measurement helpers                      |
| Core   | `src/equipments/equipment-manager.ts`         | read/write `solar_profile`                             |
| Core   | `src/index.ts`                                | instantiate, register the provider, start the timer    |
| API    | `src/api/routes/energy.ts`                    | two routes                                             |
| UI     | 4 files above                                 | panel, form, page wiring, i18n                         |
| Plugin | `src/index.ts`, `src/payload.ts`              | `irradiance_120h`                                      |

## Failure modes

| Failure                            | Behaviour                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Irradiance series absent or stale  | Last curve kept, its age shown, no new points persisted                               |
| InfluxDB down                      | Forecast still computed and exposed; persistence skipped, logged, accuracy goes stale |
| Fewer samples than the floor       | No model, no curve, panel says the model is still learning                            |
| A plane with absurd geometry       | Rejected at validation, named field, profile not saved                                |
| Sun below horizon                  | POA zero, forecast zero                                                               |
| Production sample above peak power | Excluded from the fit, logged, still drawn on the actual curve                        |
