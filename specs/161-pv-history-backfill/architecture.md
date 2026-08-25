# Architecture — Spec 161

## Where the data comes from

```
weather plugin (2.3.0)
  ├─ irradiance_120h      json, every poll   — the forecast, spec 160
  └─ irradiance_history   json, once a day   — the past 45 days, daylight only
                                                {issuedAt, hours:[{t,direct,diffuse,temp}]}

InfluxDB  sowel-hourly
  └─ equipment_data, alias=power, _field=mean, hourly, 90 d retention

                      ↓  PvForecaster.backfill(equipmentId)

  pair on the hour → planeOfArray(declared planes) → pv_forecast_sample
                                                   → fitModel → pv_forecast_model
```

The core never calls a weather API. That is the same boundary spec 160 drew, and
the reason `irradiance_history` exists as a published series rather than as a
fetch inside `pv-forecaster.ts`.

## Why daylight only, once a day

45 days of every hour is about 2 200 points, roughly 130 KB, broadcast on every
`device.data.updated` with its `previous` value alongside. Restricted to hours
with any irradiance at all it is about 630 points, and it changes meaningfully
only when a day rolls over.

The forward series keeps its own cadence; the two are independent.

## Data model

`SolarProfile` gains one optional field:

```ts
interface SolarProfile {
  planes: SolarPlane[];
  /** ISO date. The array has been in this configuration since. Bounds a backfill. */
  since?: string;
}
```

Stored in the existing `equipments.solar_profile` JSON column — **no migration**.
An older core reading a profile with `since` ignores an unknown key; a newer core
reading one without it applies the 45-day bound.

No new table. Backfilled rows go into `pv_forecast_sample` exactly as live ones
do, upserted on `(equipment_id, at)`, which is what makes FR6 free.

## The window

```
from = max(now - WINDOW_DAYS, since ?? -∞)
to   = now
```

`WINDOW_DAYS` is spec 160's 45. `since` only ever shortens the window; a date
older than the window, in the future, or unparseable is discarded. This is
deliberately not a "use the longest history you can" rule — see the spec's
measurement of seasonal drift.

## Both sides label an hour by its end

Worth writing down, because it looks wrong twice over and a plausible-sounding
"fix" in either direction breaks a join that is already correct.

`sowel-downsample-hourly` aggregates without `timeSrc`, and Flux defaults that to
`_stop`, so a point in `-hourly` at 09:00 is the mean of 08:00-09:00. Verified
against the raw bucket on production data: 159 of 166 hours match to the last
decimal at exactly that offset.

Open-Meteo arrives at the same convention from the other direction: its radiation
variables are documented as **preceding-hour means**, so the entry labelled 14:00
covers 13:00-14:00. On the reference site the series peaks at 14:00 local against
a solar noon of 13:37, which is the convention showing through, not an error.

So the two agree, and neither reader shifts anything. Measured when a shift was
tried on the production side alone: the fitted gain went from 3.8 to 45.8 and the
hourly shape collapsed into a monotonic decay from sunrise, because production
was then paired with the irradiance of the hour before it.

`hour_local` inherits the same convention — the "13 h" bucket is 12:00-13:00 —
and since the fit and the prediction both use it, the model is self-consistent.

## Pairing

Identical arithmetic to `collectSample`, on stored hours instead of live ones:

1. hour start in UTC, from the production series
2. the irradiance entry for the same hour, skipped if absent or null
3. `solarPosition` at mid-hour, `toDni`, `planeOfArray` over the declared planes
4. `hour_local` from the hour start, as the live path does

Reusing the same functions is the point: a backfilled sample that disagreed with
a live one would make the model depend on how a row happened to be produced.

## API

```
POST /api/v1/energy/pv-forecast/:equipmentId/backfill      (admin)
  200 { hoursPaired, windowFrom, windowTo, boundedBy, model | null, reason? }
  400 no array declared
  409 no irradiance history published
  503 forecaster or Influx unavailable
```

`boundedBy` is `"window"` or `"declaration"`, so FR5 can say why.

## Files

| File                                                | Change                                               |
| --------------------------------------------------- | ---------------------------------------------------- |
| `src/shared/types.ts`                               | `SolarProfile.since`                                 |
| `src/energy/pv/pv-backfill.ts`                      | new — pairing and window logic, pure where it can be |
| `src/energy/pv/pv-forecaster.ts`                    | `backfill()`, reads `irradiance_history`             |
| `src/api/routes/energy.ts`                          | the route                                            |
| `src/api/routes/equipments.ts`                      | `since` through the body schema                      |
| `ui/src/components/equipments/SolarProfileForm.tsx` | the date field                                       |
| `ui/src/components/equipments/PvForecastPanel.tsx`  | the action and its report                            |
| plugin `src/open-meteo.ts`                          | `fetchIrradianceHistory`                             |
| plugin `src/index.ts`                               | publish `irradiance_history`, daily                  |

## Why `pv-backfill.ts` is separate

`pv-forecaster.ts` is the file spec 160's review kept finding defects in, and
every one of them was in stateful code that could not be exercised without a
database and a clock. The pairing and the window are neither: they are a function
from two series and a date to a list of samples. Keeping them in their own module
means the part with the arithmetic is testable directly, and the part that talks
to Influx and SQLite stays thin.
