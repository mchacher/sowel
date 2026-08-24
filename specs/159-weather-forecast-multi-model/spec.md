# Spec 159 — Weather forecast: multi-model and ensemble confidence

## Context

`sowel-plugin-weather-forecast` (spec 041) calls Open-Meteo without a `models`
parameter, so it gets `best_match`. Measured on 2026-08-24 by comparing
`best_match` hourly `temperature_2m` against every candidate model over 48 h:

| Location          | `best_match` resolves to | AROME France HD    |
| ----------------- | ------------------------ | ------------------ |
| 45.75/4.85 (Lyon) | `icon_d2` 48/48          | 5/48 (coincidence) |
| Toulouse          | `icon_d2` 48/48          | 2/48               |
| Brest             | (outside ICON-D2 domain) | 32/48              |

Beyond 48 h the reference point falls to `icon_eu`, never to ARPEGE. So over a
large part of France the forecast driving Sowel is a German 2.2 km model and the
national high-resolution models are never consulted. Which model runs is a
function of the household's coordinates, is invisible in the UI, and cannot be
configured.

The second gap is that a blended `best_match` value cannot express **how much to
trust itself**. A recipe deciding to pre-cool because tomorrow reaches 34 C has
no way to distinguish forty ensemble members agreeing within 0.8 C from members
spread over 5 C. Measured at the reference point, the day-ahead temperature
spread ranged from 1.1 C to 8.1 C across five days.

Design rationale and all measurements:
`docs/planning/2026-08-24-weather-multi-model.md`, sections 2 and 3.

## Goals

1. Query every deterministic model that covers the household's coordinates, and
   resolve each daily value from the best model available for that day, instead
   of accepting Open-Meteo's undisclosed pick.
2. Expose a per-day confidence derived from two independent spreads, so recipes
   can branch on how trustworthy a forecast is.
3. Replace the rain probability with a genuine probability computed over
   ensemble members, which is also the only way to keep it working once
   Meteo-France models are in the set.
4. Change nothing about the 25 existing `jN_*` aliases: no migration, no
   re-binding, no recipe change.

## Non-Goals

- **Hourly irradiance series.** Deferred to the release that ships its consumer
  (the PV production model). A `json` device data value currently renders as
  `[object Object]` in generic UI views, so publishing an inert series now would
  be a visible wart with no benefit.
- **Local bias correction** against a household sensor. That is core work and
  its own spec: it joins two integrations through a user-level notion, which is
  not an integration plugin's mandate.
- **A second weather provider.** Multi-model buys meteorological confidence, not
  service redundancy; every call still goes to Open-Meteo.
- **Model comparison curves in the UI.** Showing four models side by side is
  `releve-meteo`'s product; Sowel's product is a decision. One figure plus a
  spread, not four curves.
- **Colour-coding the confidence.** It would compete with the condition colours
  already on the card.

## Functional Requirements

### FR1 — Candidate model discovery

The plugin requests a fixed superset of models on the existing daily call. Models
that do not cover the coordinates are simply absent from Open-Meteo's response,
which was verified: the same request that returns AROME/ARPEGE/ICON-EU in France
returns HRRR/GFS/ECMWF/UKMO in New York. Whatever comes back is the candidate set
for that installation.

No geography is hard-coded. A German household gets ICON-D2, an American one
HRRR, a French one AROME, with no configuration.

### FR2 — Per-day value resolution

For each forecast day and each variable, the value is resolved from the available
models by this rule:

| Horizon        | Rule                                                          |
| -------------- | ------------------------------------------------------------- |
| J+1            | Median of the models within 1.5x of the finest grid available |
| J+2 and beyond | Median of every available deterministic model                 |

The rationale is measured (planning doc 3.1): at short range a high-resolution
regional model is not in the same class as a global one, while beyond J+2 no
model has a clear edge and a single pick is a bet. At J+3 at the reference point,
ARPEGE said 34.1 C, ICON-EU 29.5 C, and the median 33.1 C.

At J+1 the rule is a median over a **class**, not an election. Measured at the
reference point, four models answer at 2 to 2.5 km: ICON-2I, DMI Harmonie,
ICON-D2 and AROME. Electing the 2 km one would be arbitrary, since nothing says a
foreign 2 km grid beats the national 2.5 km one there, and it would make the
published value hostage to a single provider. A 7 km model has no business in
that class, which is what the 1.5x factor excludes. Where a single model is alone
in its class it is named directly rather than reported as `median(1)`: measured
at New York, HRRR at 3 km with nothing else finer than 10 km.

The rule is data-driven, not hard-coded per horizon: a model returning `null`
(end of its horizon, variable not carried) drops out of the set for that day.
If every model fails, the plugin falls back to `best_match`, i.e. today's
behaviour.

### FR3 — Variable availability handling

Measured availability differs per model and this MUST be handled explicitly:

| Variable                        | AROME HD | AROME 2.5 km | ARPEGE   | ICON / GFS |
| ------------------------------- | -------- | ------------ | -------- | ---------- |
| `temperature_2m_min/max`        | yes      | yes          | yes      | yes        |
| `wind_gusts_10m_max`            | yes      | yes          | yes      | yes        |
| `weather_code`                  | **null** | yes          | yes      | yes        |
| `precipitation_probability_max` | **null** | **null**     | **null** | yes        |

Two consequences:

- The 2.5 km `meteofrance_arome_france` variant is used, never the HD variant,
  which carries no `weather_code`.
- `precipitation_probability_max` is null on **every** Meteo-France model, so
  `jN_rain_prob` must not be sourced from the deterministic call (see FR4).

### FR4 — Rain probability from ensemble members

`jN_rain_prob` keeps its alias, unit and category. Its value becomes
`P(precipitation >= 0.5 mm)` counted over the members of a global ensemble model,
which is a genuine probability rather than a model-side heuristic, and is
available for every day.

If the ensemble call fails, the value falls back to
`best_match precipitation_probability_max`, then to `null`.

This is a deliberate silent improvement: the `auto-watering` recipe reads this
alias through its `forecastThreshold` parameter and benefits with no user action.
The threshold keeps the same meaning; only the underlying figure changes.

### FR5 — Confidence, from two independent spreads

Two error sources are measured differently and neither subsumes the other:

- **Model error** (physics, resolution): the spread between the deterministic
  models, already in the FR1 call, free.
- **Initial-condition error**: the spread across the ensemble members.

Measured over five days at the reference point, the two rank the days
consistently but disagree on magnitude by a factor of two in both directions. The
plugin therefore takes **the wider of the two**: claiming more confidence than the
most pessimistic available measure is the failure mode that would actually hurt,
since a recipe acts on it.

Both terms must be the same _kind_ of statistic, or the comparison is
meaningless. The inter-model term is therefore a p10-p90 band once at least five
models answer, not a min-max range: a range grows with the number of models, so a
French household seeing ten of them would systematically report less confidence
than an American one seeing five, for identical meteorological uncertainty. Below
five models the plain range is used, a band over four points being noise.

New data points, for J+1 to J+3 only (beyond J+3 the spread is wide enough that
the index would read `low` permanently and carry no information):

| Key                                         | Type   | Category            | Unit |
| ------------------------------------------- | ------ | ------------------- | ---- |
| `j1_temp_max_spread` … `j3_temp_max_spread` | number | temperature_outdoor | °C   |
| `j1_confidence` … `j3_confidence`           | enum   | generic             | —    |

`jN_confidence` is `high` / `medium` / `low`, derived from the spread against two
thresholds exposed as settings (defaults 2 C and 5 C).

### FR6 — Source transparency

A `model_used` text data point reports what fed J+1: a model id when one model is
alone in its class, `median(n)` otherwise. The forecast stays auditable either
way. This is the honest
version of what a multi-model comparison UI shows visually.

### FR7 — Model override setting

A `models` setting accepts:

- empty or `auto` (default): the discovery of FR1;
- `best_match`: the escape hatch, restoring the pre-2.0 **deterministic source**
  for every `jN_*` value;
- a comma-separated list of Open-Meteo model ids: forced set.

An unknown id is dropped and named in a `warn` rather than sent. This matters
more than it looks: Open-Meteo rejects the _entire_ request when a single id is
unknown, so passing a typo straight through would silently drop the household
back to `best_match` on every poll, forever. If every id in the list is unknown,
the setting falls back to the FR1 superset rather than to an empty list, which
would mean `best_match` and is a different setting.

`best_match` restores the deterministic source, not the whole of v1.0.0: the
ensemble call still runs, so `jN_rain_prob` keeps the improvement of FR4 and
`jN_confidence` is still published. Restoring the deterministic values is the
point of the escape hatch; giving up a better rain probability is not.

### FR8 — Budget

Free tier limits are 600 calls/min, 5 000/hour, 10 000/day, with requests over
10 variables counting as more than one unit. The design is 2 HTTP calls per poll
for about 16 KB, but they are not one unit each: call A is 5 variables over up to
12 models and call B is 2 variables over 51 members, so a poll weighs roughly 15
units. At the default 30 minute interval that is about **750 units and 800 KB per
day**, an order of magnitude under the daily cap and far under the hourly one.

### FR9 — Forecast card shows confidence and source

`WeatherForecastPanel` renders one card per day. Two additions, in the existing
visual language:

- Under the daily maximum, the spread as a figure: `± 2.6` in 11 px
  `text-tertiary`. Rendered only for the days that carry it. A spread of 8 °C
  reads immediately as "this day is not actionable", which no colour code
  conveys as well.
- Under the row, one discreet 12 px line naming the source: `Source: AROME
2.5 km`, or `Source: median of 5 models`. The raw Open-Meteo id is mapped to a
  provider-and-grid label; an id absent from the map is shown as is rather than
  guessed at.

The plugin publishes the **full width** of the uncertainty band, so the card
renders half of it behind the `±`, which is what that notation means. Publishing
a width and displaying it as a half-width would double the apparent uncertainty.

Both degrade to nothing when absent, so a household still running plugin v1.0.0
sees exactly today's card. Release ordering between the core and the plugin
therefore does not matter.

## Acceptance Criteria

- [ ] The daily call carries `models=` and the response is resolved per FR2
- [ ] The 25 existing `jN_*` aliases keep their key, type, category and unit
- [ ] `jN_condition` is never null when at least one model carries `weather_code`
- [ ] `jN_rain_prob` is populated from ensemble members, with the documented
      fallback chain, and is never null when the ensemble call succeeds
- [ ] `j1..j3_temp_max_spread` and `j1..j3_confidence` are published
- [ ] `model_used` reports the J+1 source
- [ ] `models=best_match` reproduces v1.0.0's deterministic values exactly
- [ ] A failing ensemble call degrades the forecast but never fails the poll
- [ ] Total device data points: 25 existing + 7 new = 32
- [ ] The forecast card shows `± <spread>` under the maximum where available
- [ ] The forecast card shows the source model line where `model_used` exists
- [ ] With plugin v1.0.0 data (no new keys), the card renders exactly as before
- [ ] Unit tests cover every scenario of the plan's test plan
- [ ] Registry `sha256` bumped after the GitHub release (CLAUDE.md, spec 089)

## Edge Cases

| Case                                                                               | Expected                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Ensemble endpoint down or 429                                                      | `jN_rain_prob` falls back to `best_match`, confidence falls back to the model spread alone, poll succeeds, one `warn`                      |
| Deterministic multi-model call fails                                               | Retry the same call with `models=best_match`; if that fails too, the poll fails as it does today                                           |
| Every model returns null for a variable on a day                                   | That `jN_*` value is `null`; the alias is still published                                                                                  |
| Only one model covers the point                                                    | Median of one is that model; the model spread is 0, so confidence rests on the ensemble spread alone                                       |
| No ensemble model covers the point                                                 | `jN_confidence` is derived from the model spread only; if fewer than two models, `jN_confidence` is `null` rather than a fabricated `high` |
| `home.latitude` / `home.longitude` missing                                         | Unchanged: status `not_configured`, no call                                                                                                |
| Open-Meteo returns `nan` for latitude when some requested models are out of domain | Response is still valid JSON for the models that do cover; parse defensively and ignore non-finite metadata                                |
| A model returns a physically absurd value                                          | Out of scope here; no sanitisation is introduced by this spec                                                                              |
| UI receives `jN_confidence` but no `jN_temp_max_spread`                            | Card renders the day normally without the `±` line                                                                                         |
| UI receives `model_used` but no forecast days                                      | Panel returns null as it does today, no orphan source line                                                                                 |
| Spread is 0 (a single model, no ensemble)                                          | No `±` line rather than a misleading `± 0`                                                                                                 |
