# Implementation Plan — Spec 159

Two repos, two branches, two PRs. Slices A and B land in
`sowel-plugin-weather-forecast` on `feat/multi-model`; slice C lands in the core
on `feat/weather-forecast-confidence-ui`. Neither depends on the other at
runtime, so they can ship in either order.

## Slices

### Slice A — Test harness and pure modules

- A.1 — Add `vitest` to `devDependencies`, a `test` script and
  `vitest.config.ts`, mirroring `sowel-plugin-apsystems`.
- A.2 — `src/open-meteo.ts`: URL builders, and `parseDaily` demultiplexing the
  `<variable>_<model_id>` keys into `model -> variable -> values`. Must tolerate
  the `"latitude": nan` the API emits when part of the requested set is out of
  domain.
- A.3 — `src/models.ts`: `CANDIDATE_MODELS`, `MODEL_RESOLUTION_KM`, `median`,
  and `resolveDay` implementing the FR2 rule.
- A.4 — `src/ensemble.ts`: `rainProbability` and `quantiles` over members.
- A.5 — `src/confidence.ts`: `spread` (wider of the two) and `level`.

### Slice B — Wiring

- B.1 — Extend the discovered device definition: 6 confidence points for J+1 to
  J+3, plus `model_used`. 32 total.
- B.2 — Rewrite `poll()`: two fetches, pure-module resolution, one
  `updateDeviceData`. Keep the existing structured logging and never let a
  handler throw outside the existing try/catch.
- B.3 — Extend the settings schema with `models`, `confidence_high_max` and
  `confidence_medium_max`; parse and clamp them in `start()` next to
  `polling_interval`.
- B.4 — Degradation paths: ensemble failure, call A failure with a
  `best_match` retry, missing models.

### Slice C — Core UI (separate repo, separate PR)

- C.1 — `weatherForecastUtils.ts`: two optional fields on `ForecastDay`, two
  more parsed `jN_` metrics, and `parseModelUsed` for the flat binding.
- C.2 — `WeatherForecastPanel.tsx`: `± {spread}` under the maximum, one source
  line under the row. Both conditional, so v1.0.0 plugin data renders exactly
  today's card.
- C.3 — i18n keys for the source line, `en` and `fr`.
- C.4 — `weatherForecastUtils.test.ts` (the module has no test today).

### Slice D — Release

- D.1 — README: new data points, new settings, and the `models=best_match`
  escape hatch.
- D.2 — Bump `manifest.json` and `package.json` to 2.0.0. `sowelVersion` stays
  as it is, nothing here needs a newer core.
- D.3 — PR on the plugin repo, then a GitHub release with the tarball.
- D.4 — **Separate PR on the core repo**: run
  `node scripts/backfill-registry-sha256.mjs` and commit
  `plugins/registry.json` (CLAUDE.md, spec 089). Mandatory: installs of the new
  version fail with `ChecksumMismatchError` until the registry catches up.

## Test Plan

### Modules to test

- `src/open-meteo.ts` — URL construction and response demultiplexing
- `src/models.ts` — median and the per-day resolution rule
- `src/ensemble.ts` — probability and quantiles over members
- `src/confidence.ts` — spread combination and level classification

- `ui/src/components/equipments/weatherForecastUtils.ts` — parsing of the two
  new metrics and of `model_used`

`src/index.ts` is not unit tested: it is lifecycle and I/O wiring, which matches
how the other plugins draw the line. `WeatherForecastPanel` is not unit tested
either; its logic is two conditional renders over data the utils already test.

### Scenarios

| Module        | Scenario                                                   | Expected                                                          |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| open-meteo    | `buildDailyUrl` with 4 models                              | `models=a,b,c,d`, `timezone=auto`, `forecast_days=6`              |
| open-meteo    | `buildDailyUrl` with an empty model list                   | No `models` parameter at all (equivalent to `best_match`)         |
| open-meteo    | `parseDaily` on a 2-model response                         | `{ arome: { temperature_2m_max: [...] }, icon_eu: {...} }`        |
| open-meteo    | `parseDaily` on a single-model response with no suffix     | Keys map to that model id                                         |
| open-meteo    | `parseDaily` with `"latitude": nan` in the payload         | Parses without throwing; models present are returned              |
| open-meteo    | `parseDaily` on a payload with no `daily` key              | Throws a typed error, not a `TypeError`                           |
| open-meteo    | `parseEnsembleDaily` on members                            | `{ temperature_2m_max: [[m1...], [m2...]] }` per day              |
| models        | `median` on an odd count                                   | Middle value                                                      |
| models        | `median` on an even count                                  | Mean of the two middle values                                     |
| models        | `median` on a single value                                 | That value                                                        |
| models        | `resolveDay` at J+1 with AROME and ICON present            | AROME value, source `meteofrance_arome_france`                    |
| models        | `resolveDay` at J+1 with AROME null                        | Next best resolution, source is that model                        |
| models        | `resolveDay` at J+3 with 5 models                          | Median, source `median(5)`                                        |
| models        | `resolveDay` at J+3 with ARPEGE 34.1 and ICON 29.5 outlier | Median, not the outlier (the measured case from the planning doc) |
| models        | `resolveDay` with all values null                          | `{ value: null, source: "none" }`                                 |
| models        | `resolveDay` with exactly one non-null model               | That value, source is that model id, not `median(1)`              |
| ensemble      | `rainProbability` with 40 members, 30 above 0.5 mm         | 75                                                                |
| ensemble      | `rainProbability` with all members dry                     | 0                                                                 |
| ensemble      | `rainProbability` with nulls mixed in                      | Nulls ignored, computed over the rest                             |
| ensemble      | `rainProbability` with fewer than the minimum members      | `null`                                                            |
| ensemble      | `quantiles` on a known series                              | p10/p50/p90 match hand-computed values                            |
| ensemble      | `quantiles` on an empty or all-null series                 | `null`                                                            |
| confidence    | `spread` with model spread 2.1 and ensemble p10/p90 2.6    | 2.6 (the wider)                                                   |
| confidence    | `spread` with model spread 4.6 and ensemble 8.1            | 8.1 (the measured J+3 case)                                       |
| confidence    | `spread` with no ensemble                                  | Model spread alone                                                |
| confidence    | `spread` with a single model and no ensemble               | `null`                                                            |
| confidence    | `level` with spread 0.8 and defaults                       | `high`                                                            |
| confidence    | `level` with spread 3.0                                    | `medium`                                                          |
| confidence    | `level` with spread 6.0                                    | `low`                                                             |
| confidence    | `level` with spread `null`                                 | `null`, never `high`                                              |
| confidence    | `level` at exactly the threshold                           | Documented boundary respected (inclusive on the lower side)       |
| retro-compat  | `models=best_match` end to end on a captured payload       | Same 25 values as v1.0.0 on the same input                        |
| forecastUtils | `parseForecastDays` on v2 bindings                         | `tempMaxSpread` and `confidence` populated on J+1..J+3            |
| forecastUtils | `parseForecastDays` on v1.0.0 bindings                     | Both fields `null`, all existing fields unchanged                 |
| forecastUtils | `parseForecastDays` with a spread but no confidence        | Spread kept, confidence `null`                                    |
| forecastUtils | `parseForecastDays` with a non-numeric spread value        | Field stays `null`, no throw                                      |
| forecastUtils | `parseModelUsed` with the binding present                  | Returns the string                                                |
| forecastUtils | `parseModelUsed` with no such binding                      | Returns `null`                                                    |
| forecastUtils | `parseModelUsed` on a non-string value                     | Returns `null`                                                    |

### Fixtures

Real captured Open-Meteo payloads, trimmed, committed under `src/__fixtures__/`:
one multi-model daily response for a French point, one for New York (proving the
regional models drop out on their own), one ensemble response. Recorded from the
live API on 2026-08-24, so the tests exercise the real shape rather than an
idealised one.

## Validation Plan

- `npx tsc --noEmit` in the plugin repo — zero errors
- `npm test` in the plugin repo — green
- `cd ui && npx tsc -b --noEmit` and `npx vitest run` in the core repo — green
- `npx eslint src/ --ext .ts` and `cd ui && npx eslint .` — zero errors
- Build the tarball and install it on the **shadow** instance, never on prod
  (`feedback_no_prod_deploy_without_authorization`), and verify:
  - the 25 existing aliases still populate,
  - `model_used` names a plausible model,
  - `jN_confidence` is not uniformly `low`,
  - the logs show one poll line, no error.
- Compare one poll's `jN_temp_max` against `best_match` for the same point to
  confirm the values moved in the expected direction.

## Out of this plan

- Hourly irradiance series (deferred with its consumer)
- Local bias correction (core, separate spec)
- Colour-coding the confidence, and any model-comparison view
