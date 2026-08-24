# Architecture — Spec 159

Two repos, two PRs, one spec. The data side lives in
`sowel-plugin-weather-forecast`; the core side is **UI only**, in
`WeatherForecastPanel`. No new `DataCategory`, no migration, no event, no API
route. Release ordering between the two does not matter: each side degrades to
today's behaviour without the other.

## Flow diagram

```
poll (every 30 min, min 15)
  │
  ├─ call A  api.open-meteo.com/v1/forecast
  │          daily = weather_code, temperature_2m_min/max,
  │                  wind_gusts_10m_max
  │          models = <superset>                       ~2.4 KB
  │            │
  │            └─ models absent from the response do not cover this point
  │
  ├─ call B  ensemble-api.open-meteo.com/v1/ensemble
  │          daily = temperature_2m_max, precipitation_sum
  │          models = <one global ensemble>            ~6.8 KB
  │
  ▼
resolve.ts        per day, per variable:
                    J+1        -> best available resolution, alone
                    J+2..J+5   -> median of available models
                    null       -> model drops out of the set for that day
  │
  ▼
ensemble.ts       P(precip >= 0.5 mm) over members  -> jN_rain_prob
                  p10/p50/p90 of temperature_2m_max -> ensemble spread
  │
  ▼
confidence.ts     spread = max(model spread, ensemble spread)
                  level  = high | medium | low   (two settings thresholds)
  │
  ▼
deviceManager.updateDeviceData("weather-forecast", "Weather Forecast", payload)
  │
  └─ 32 keys: 25 unchanged + 6 confidence + model_used
```

Downstream is untouched: `device.data.updated` → equipment bindings → zone →
WebSocket, exactly as today.

## Components

The current plugin is a single 479-line `src/index.ts` with the HTTP call, the
parsing and the lifecycle interleaved, which is untestable. The logic is
extracted into pure modules, following the pattern already used by
`sowel-plugin-apsystems` (`apsystems-parser.ts` + `apsystems-parser.test.ts`).

### New: `src/models.ts`

The candidate superset and the per-day resolution of FR2.

```ts
export const CANDIDATE_MODELS: readonly string[]; // regional + global, no geography
export const MODEL_RESOLUTION_KM: Record<string, number>;

/** One day of one variable, resolved across the models that carry it. */
export function resolveDay(
  values: Record<string, number | null>, // model id -> value
  horizonDays: number,
): { value: number | null; source: string };

export function median(xs: number[]): number;
```

`resolveDay` returns the source label that feeds `model_used`: a model id at
J+1, `median(<n>)` beyond.

### New: `src/ensemble.ts`

```ts
export function rainProbability(members: (number | null)[], thresholdMm: number): number | null;
export function quantiles(
  members: (number | null)[],
): { p10: number; p50: number; p90: number } | null;
```

Both ignore null members and return `null` below a minimum member count rather
than fabricating a figure from two members.

### New: `src/confidence.ts`

```ts
export function spread(
  modelValues: number[],
  ensembleP10P90: [number, number] | null,
): number | null;
export function level(
  spreadC: number | null,
  thresholds: { high: number; medium: number },
): "high" | "medium" | "low" | null;
```

`spread` takes the wider of the two measures (FR5). `level` returns `null` rather
than `high` when there is nothing to measure, so a missing signal never reads as
a confident one.

### New: `src/open-meteo.ts`

URL builders and response shape parsing, kept separate from `fetch` so the
parsers are testable without network.

```ts
export function buildDailyUrl(lat: string, lon: string, models: string[], days: number): string;
export function buildEnsembleUrl(lat: string, lon: string, model: string, days: number): string;
export function parseDaily(json: unknown): Record<string, Record<string, (number | null)[]>>;
export function parseEnsembleDaily(json: unknown): Record<string, (number | null)[][]>;
```

`parseDaily` demultiplexes Open-Meteo's `<variable>_<model_id>` suffixed keys back
into a `model -> variable -> values` map, and tolerates the `"latitude": nan` the
API emits when part of the requested set is out of domain.

### Changed: `src/index.ts`

Keeps the lifecycle (`start`, `stop`, `poll`, `refresh`, retry/backoff) and the
device definition. `poll()` becomes: two fetches, then a call into the pure
modules, then one `updateDeviceData`. The settings schema gains three entries.

### Changed: `manifest.json`

Version `2.0.0`, plus the three new settings. `sowelVersion` is **unchanged**:
nothing here needs a newer core.

### New: `vitest.config.ts`, dev dependency `vitest`

The repo has no test setup today. Added exactly as in `sowel-plugin-apsystems`:
`"test": "vitest run"` and vitest in `devDependencies`.

### Changed (core): `ui/src/components/equipments/weatherForecastUtils.ts`

`ForecastDay` gains two optional fields and `parseForecastDays` learns two more
`jN_` metrics. A separate helper reads `model_used`, which is a flat binding
rather than a `jN_` one:

```ts
export interface ForecastDay {
  // ... existing fields unchanged
  tempMaxSpread: number | null; // new
  confidence: "high" | "medium" | "low" | null; // new
}

export function parseModelUsed(bindings: DataBindingWithValue[]): string | null;
```

Both stay `null` on plugin v1.0.0 data, which is what keeps the card unchanged
for households that have not upgraded.

### Changed (core): `ui/src/components/equipments/WeatherForecastPanel.tsx`

- In `ForecastDayCard`, under the maximum: `± {spread}` in 11 px
  `text-text-tertiary`, rendered only when `tempMaxSpread` is a positive number.
  A spread of 0, which means a single model and no ensemble, renders nothing
  rather than a misleading `± 0`.
- Under the scrollable row: one 12 px `text-text-tertiary` line naming the
  source, rendered only when `model_used` exists.

No new colour, no new icon, no layout change. Tailwind utilities only, per
`CLAUDE.md`.

### New (core): `ui/src/i18n/locales/{en,fr}.json`

Two keys for the source line. No other copy is added.

## Device data points

25 unchanged, 7 added, 32 total.

| Key                                         | Type   | Category            | Unit | Status                         |
| ------------------------------------------- | ------ | ------------------- | ---- | ------------------------------ |
| `j1_condition` … `j5_condition`             | enum   | weather_condition   | —    | unchanged key, better source   |
| `j1_temp_min` … `j5_temp_min`               | number | temperature_outdoor | °C   | unchanged key, better source   |
| `j1_temp_max` … `j5_temp_max`               | number | temperature_outdoor | °C   | unchanged key, better source   |
| `j1_rain_prob` … `j5_rain_prob`             | number | rain                | %    | unchanged key, ensemble source |
| `j1_wind_gusts` … `j5_wind_gusts`           | number | wind                | km/h | unchanged key, better source   |
| `j1_temp_max_spread` … `j3_temp_max_spread` | number | temperature_outdoor | °C   | **new**                        |
| `j1_confidence` … `j3_confidence`           | enum   | generic             | —    | **new**                        |
| `model_used`                                | text   | generic             | —    | **new**                        |

`jN_confidence` uses category `generic` deliberately: it is not a weather
measurement and must not be aggregated by zones or historised as one.

## Settings

| Key                     | Type   | Default        | Purpose                                              |
| ----------------------- | ------ | -------------- | ---------------------------------------------------- |
| `polling_interval`      | number | 30             | unchanged                                            |
| `models`                | text   | (empty = auto) | FR7 override; `best_match` restores v1 behaviour     |
| `confidence_high_max`   | number | 2              | spread in °C below which confidence is `high`        |
| `confidence_medium_max` | number | 5              | spread below which it is `medium`, above which `low` |

All under `integration.weather-forecast.*`, which is the plugin's own namespace,
so the spec 111 settings Proxy allows read and write.

## Files changed

| Repo   | File                                                        | Change                                                             |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| plugin | `src/models.ts`                                             | **new** — candidate set, per-day resolution, median                |
| plugin | `src/ensemble.ts`                                           | **new** — member-based probability and quantiles                   |
| plugin | `src/confidence.ts`                                         | **new** — spread combination and level                             |
| plugin | `src/open-meteo.ts`                                         | **new** — URL builders, response demultiplexing                    |
| plugin | `src/*.test.ts`                                             | **new** — one per pure module                                      |
| plugin | `src/index.ts`                                              | rewritten `poll()`, extended device definition and settings schema |
| plugin | `manifest.json`                                             | version 2.0.0, three new settings                                  |
| plugin | `package.json`                                              | version 2.0.0, vitest dev dependency, `test` script                |
| plugin | `vitest.config.ts`                                          | **new**                                                            |
| plugin | `README.md`                                                 | document the new data points and settings                          |
| core   | `ui/src/components/equipments/weatherForecastUtils.ts`      | 2 optional fields, 2 parsed metrics, `parseModelUsed`              |
| core   | `ui/src/components/equipments/weatherForecastUtils.test.ts` | **new**                                                            |
| core   | `ui/src/components/equipments/WeatherForecastPanel.tsx`     | spread under the max, source line under the row                    |
| core   | `ui/src/i18n/locales/{en,fr}.json`                          | source line copy                                                   |
| core   | `plugins/registry.json`                                     | `sha256` bump after the release (separate PR)                      |
| core   | `specs/159-*`                                               | this spec                                                          |

## Failure modes

| Failure                             | Behaviour                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Call B (ensemble) fails             | `jN_rain_prob` falls back to `best_match`, confidence uses the model spread alone, poll succeeds, one `warn` with `{ err }`      |
| Call A fails                        | One retry with `models=best_match`; if that fails, the poll throws as it does today and the existing exponential backoff applies |
| A model missing from the response   | Not an error: it does not cover the point, it is simply not a candidate                                                          |
| Fewer than 2 models and no ensemble | `jN_confidence` and `jN_temp_max_spread` are `null`, never a fabricated `high`                                                   |
| Malformed JSON                      | Caught by the existing try/catch in `poll()`, logged with `{ err }`, backoff applies                                             |
