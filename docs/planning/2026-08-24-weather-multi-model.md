# Weather forecast: multi-model and ensemble

Status: draft, not a spec yet. Written 2026-08-24.
Scope: `sowel-plugin-weather-forecast` (specs 041/042), with a small core
touchpoint for the forecast equipment view. Unblocks Phase 3 of
`docs/planning/2026-08-23-arbiter-predictive.md`.
Not published on the docs site (`docs/planning/` is excluded in `mkdocs.yml`).

## 1. Where this came from

The trigger was `lachand/releve-meteo`, a static PWA that displays several
weather models side by side for France and shows how much they diverge. The
repository itself is not reusable here: no backend, no library, no API, it is a
front end that calls the public Open-Meteo endpoints from the browser. But it
points at a real gap, and investigating that gap turned up something sharper
than "show more models".

## 2. Measured findings

All figures below were measured against the live Open-Meteo API on 2026-08-24
(reference point 45.75/4.85, plus Brest and Toulouse where noted).

### 2.1 `best_match` does not use the French models

The plugin calls `api.open-meteo.com/v1/forecast` with no `models` parameter,
so it gets `best_match`. Comparing `best_match` hourly `temperature_2m` against
each candidate model over 48 hours, counting exact matches:

| Location   | best_match is           | AROME France HD    |
| ---------- | ----------------------- | ------------------ |
| 45.75/4.85 | `icon_d2` 48/48         | 5/48 (coincidence) |
| Toulouse   | `icon_d2` 48/48         | 2/48               |
| Brest      | (out of ICON-D2 domain) | 32/48              |

Beyond 48 hours the reference point switches to `icon_eu` 48/48, never to
ARPEGE.

So over a large part of France the forecast driving Sowel today is ICON-D2, a
2.2 km DWD model, and AROME (1.5 to 2.5 km, Meteo-France, the national
reference) is never consulted. ICON-D2 is not a bad model. The problem is that
which model runs is a function of the household's coordinates, it is invisible
in the UI, and it is not configurable.

### 2.2 Multi-model works, but the variables are not uniform

`&models=a,b,c` returns one suffixed series per model
(`temperature_2m_max_meteofrance_arome_france`). Measured availability:

| Variable                        | AROME HD (1.5 km) | AROME France (2.5 km) | ARPEGE EU (11 km) | ICON-EU / GFS  |
| ------------------------------- | ----------------- | --------------------- | ----------------- | -------------- |
| `temperature_2m_min/max`        | yes               | yes                   | yes               | yes            |
| `wind_gusts_10m_max`            | yes               | yes                   | yes               | yes            |
| `weather_code`                  | **null**          | yes                   | yes               | yes            |
| `precipitation_probability_max` | **null**          | **null**              | **null**          | yes            |
| `precipitation_sum`             | yes               | yes                   | yes               | yes            |
| `shortwave_radiation` (hourly)  | **null**          | yes                   | yes               | yes            |
| `cloud_cover` (hourly)          | **null**          | yes                   | yes               | yes            |
| Horizon                         | J+1               | J+1                   | J+3               | J+4 and beyond |

Two consequences that a naive `models=` swap would get wrong:

- `jN_condition` breaks on AROME HD (`weather_code` null). The 2.5 km
  `meteofrance_arome_france` variant is the right pick, not the HD one.
- `jN_rain_prob` breaks on **every** Meteo-France model. This matters: the
  `auto-watering` recipe branches on it through `forecastThreshold` ("do not
  water if tomorrow's rain probability exceeds N%"). Swapping the model without
  handling this would silently disable that guard.

### 2.3 The ensemble API is free, and it is the real prize

`ensemble-api.open-meteo.com` is in the same free tier. `models=icon_eu`
returns **40 members**, `gfs025` and `icon_d2` also work (no Meteo-France
ensemble is exposed). One call, 6.8 KB for 3 days of daily data.

Measured at the reference point:

| Day | P(rain >= 0.5 mm) from members | tmax p10 / p50 / p90 | min to max |
| --- | ------------------------------ | -------------------- | ---------- |
| J0  | 75 %                           | 32.2 / 32.8 / 33.3   | 1.8 C      |
| J+1 | 32 %                           | 28.5 / 29.8 / 31.1   | 4.4 C      |
| J+2 | 0 %                            | 31.8 / 32.6 / 33.3   | 2.7 C      |

That is a genuine probability computed from members, not a model-side
heuristic, and it is available where `precipitation_probability_max` is null.
(Section 3.2 quotes p90 minus p10 for the same days, which is the narrower and
more robust of the two ways to read a spread. Both are listed on purpose.)

And it is the only way to get **the number Sowel is actually missing**: how
much to trust tomorrow's figure. A blended `best_match` value cannot express
that by construction, because there is only one of it.

For irradiance the same call gives 40 members of `shortwave_radiation`. At 13 h
the members spanned 553 to 748 W/m2 (p10 about 625, p90 about 745). That is
precisely the confidence interval Phase 4 of the arbiter roadmap asks for
("a confidence interval that widens with forecast age and cloud variability").

### 2.4 Budget

Free tier: 600 calls/min, 5 000/hour, 10 000/day. A request over 10 variables
counts as more than one unit. The design below is 3 calls per poll, about 14 KB.
At the default 30 minute interval that is about 144 calls and 700 KB per day,
two orders of magnitude under the limit.

## 3. Design

One plugin, one poll, three calls, no new dependency, no API key.

### 3.1 Every model every day, two different jobs

All the models are fetched on every poll, in a single HTTP call. What the
resolution rules below decide is not _which models to download_, it is which
one feeds **the value** of a binding, because a binding is one number.

The models that do not feed the value are not discarded: they feed the
confidence (3.2). Those are two distinct jobs and they want two different
rules.

**The value.** Two regimes, because model skill is not uniform across the
horizon:

```
J0, J+1     AROME France 2.5 km alone
            No other model competes at that range over France: 2.5 km against
            11 km (ARPEGE), 7 km (ICON-EU), 25 km (GFS, ECMWF).

J+2 .. J+5  median of the available deterministic models
            ARPEGE Europe, ICON-EU, GFS, ECMWF IFS 0.25, UKMO 10 km.
            Beyond J+2 no model has a clear edge, and a median absorbs an
            outlier where a single pick would follow it.

rain_prob   P(precipitation >= 0.5 mm) over the 40 ensemble members, all days.
            Fallback: best_match precipitation_probability_max.
```

The J+2 rule is not a preference, it is what the data shows. Measured at the
reference point for J+3 `temperature_2m_max`: ARPEGE 34.1, ICON-EU 29.5, GFS
33.2, ECMWF 33.1, UKMO 32.2. Picking ARPEGE because it is the French model
gives 34.1; picking ICON-EU gives 29.5; the median gives 33.1. Committing to
one model at that range is a bet, and the earlier version of this document was
making it.

Both rules are data-driven rather than hard-coded per horizon: a model that
returns null (end of its horizon, variable not carried) simply drops out of the
set for that day. AROME disappearing after J+1 is the same mechanism as ARPEGE
disappearing after J+3. If every French model is unreachable the set degrades to
ICON and GFS, which is today's behaviour.

The 25 existing `jN_*` bindings keep their aliases, their units and their
semantics. Nothing to migrate, no recipe to touch, no equipment to re-bind.
What changes is what is behind the number.

Expose the resolution as a `model_used` text data point (`"arome_france"`, or
`"median(5)"`), so the forecast card can say where the figure came from. That
is the honest version of what `releve-meteo` shows visually.

### 3.2 Confidence, from two independent spreads

Two things can be wrong in a forecast, and they are measured differently:

- **Model error** (physics, resolution, parameterisation): read from the spread
  between the deterministic models. Already in the call above, costs nothing.
- **Initial-condition error**: read from the 40 members of the ICON-EU
  ensemble. One extra call, 6.8 KB.

They do not measure the same thing and neither subsumes the other. Measured
over five days at the reference point, on `temperature_2m_max`:

| Day | Inter-model spread (6 models) | Ensemble spread (p10 to p90, 40 members) |
| --- | ----------------------------- | ---------------------------------------- |
| J0  | 1.9 C                         | 1.1 C                                    |
| J+1 | 2.1 C                         | 2.6 C                                    |
| J+2 | 2.6 C                         | 1.5 C                                    |
| J+3 | **4.6 C**                     | **8.1 C**                                |
| J+4 | 2.9 C                         | 4.8 C                                    |

They rank the days consistently (J+3 is the shaky one either way), but they
disagree on magnitude by a factor of two in both directions. Take **the wider of
the two**: claiming more confidence than the most pessimistic available measure
is the one failure mode that would actually hurt, since a recipe acts on it.

Bindings, per day J+1 to J+3:

- `jN_temp_max_spread` (number, C): the wider of the two spreads.
- `jN_confidence` (enum `high` / `medium` / `low`): derived from that spread,
  thresholds in the plugin settings, defaults around 2 C and 5 C.

Six data points, plus `model_used`, plus `jN_rain_prob` gaining a real
probability under an unchanged alias. Seven new entries against 25 today.

`jN_confidence` is what a recipe branches on. "Pre-cool because J+3 is 34 C" is
a different decision when the models agree within 1 C and when ARPEGE and ICON
are 4.6 C apart. Today no recipe can tell those two apart, and neither can the
user.

### 3.3 The hourly series, and the roadmap's open question

Phase 3 of the arbiter roadmap needs hourly irradiance and leaves the shape
open: "a new data category, or a dedicated store outside the binding model?"

There is a third answer, and it needs no core change at all:
`DataType` already includes `"json"`, and `normalizeValue` passes a `json`
value through untouched (`src/shared/value-normalization.ts:43`). A plugin can
publish an entire series as one data point today:

```
key: "irradiance_48h", type: "json", category: "solar_radiation"
value: { issuedAt, model, hours: [{ t, ghi, ghi_p10, ghi_p90, cloud }] }
```

48 points, about 6 KB, one row, one `device.data.updated` event per poll. The
Phase 4 PV forecaster reads it as a device data value like any other. No
migration, no new store, no new category, and `history-writer` already refuses
to historise it (it is not a numeric binding).

The limit is honest and worth writing down: this is a snapshot, not a time
series. It is overwritten at each poll and nothing keeps yesterday's forecast,
so forecast-versus-actual scoring (which Phase 4 will eventually want, to
calibrate) needs a real store later. That is a Phase 4 problem, not a reason to
build the store now.

### 3.4 What the UI does with it

Minimal core touch. `ui/src/components/equipments/weatherForecastUtils.ts`
parses `jN_<metric>` and drops metrics it does not know, so the new bindings are
inert until the parser learns them. Adding `confidence` and `spread` to
`ForecastDay`, then rendering a discreet marker on the forecast card (a dot, or
`+/- 4.4 C` under the max) is a contained change in the `weather_forecast`
branch of `EquipmentDetailPage.tsx:427`.

## 4. Learning the weights from the local station

The open question left by 3.1 is "who decides which model feeds the value".
The static answer (AROME at short range, median beyond) is defensible but
arbitrary. The better answer is to let the installation decide, by scoring each
model against what the household's own weather station actually measured.

This is the one place in this whole subject where learning is genuinely
warranted, and it is honest ML of the same family as Phase 4 of the arbiter
roadmap: no heavy runtime, a few hundred rows, plain TypeScript.

### 4.1 The training set already exists, on both sides

This was the feasibility risk, and it is measured, not assumed.

**Forecast side.** `previous-runs-api.open-meteo.com` returns, for each model,
what the run from N days ago predicted for a given hour
(`temperature_2m_previous_day1`, `..._day3`, ...). Measured 2026-08-24 with
`past_days=92`: HTTP 200 on the free tier, **2 232 hourly points, 92 days,
non-null at every lead, 65 KB in one call**. There is no need to wait a month
accumulating forecasts before the learner means anything: it can be trained
retroactively on install.

**Observation side.** `buildDownsampleHourlyFlux` filters on
`_measurement == "equipment_data"` and `_field == "value_number"`, so it
downsamples **every** numeric equipment binding, not just energy. Outdoor
temperature is therefore already in `sowel-hourly` with 90 days of retention
(`DEFAULT_RETENTION.hourly`, `src/core/influx-client.ts:15`), and in the daily
bucket for 5 years.

92 days of per-model forecasts, against 90 days of hourly local observations.
The learner is warm on day one.

Note what is _not_ usable: `weather_temp_extremes` (spec 134) is keyed
`PRIMARY KEY (equipment_id, alias)`, one row per equipment, overwritten every
day. It is a live envelope, not a history. Influx is the history.

### 4.2 What is learned

Per `(model, variable, lead day)`, two numbers, both EWMA over the residuals:

- **A bias.** `b = EWMA(forecast - observed)`. Corrected forecast `f' = f - b`.
- **A skill.** `mae = EWMA(|f' - observed|)`, and a weight
  `w proportional to 1 / (mae^2 + eps)`, normalised over the models available
  that day. Inverse-variance weighting is the principled combination of
  unbiased estimators, and it degrades gracefully when a model drops out of the
  set at the end of its horizon.

Final value: `sum(w_i * f'_i)`.

**The bias correction is the bigger win, and it should be stated plainly.** A
Netatmo outdoor module sitting on a south wall reads 2 to 3 C above the grid
point on a sunny afternoon. That error is larger than the spread between AROME
and ARPEGE. Correcting it turns the forecast from "what the 2.5 km grid cell
will do" into "what my station will read tomorrow", which is exactly the
quantity every recipe compares against, since recipes read the station. The
per-model weighting is the refinement on top; the debiasing is the part that
changes decisions.

Second effect, and it is free: the learner knows each model's historical MAE,
so `jN_confidence` stops being three heuristic buckets over a raw spread and
becomes calibrated. "29.8 C, +/- 1.4 C at this lead, on 90 days of this
station" is a statement the household can check.

### 4.3 Guardrails

Same spirit as the arbiter roadmap's, because the failure modes rhyme.

1. **Never worse than the best single model.** Track the blend's rolling MAE
   alongside each model's. If the blend loses to the best single model over the
   trailing window, fall back to that model and log the switch. A blend that
   quietly underperforms AROME would be the worst outcome of this whole
   exercise, and it must be impossible to reach silently.
2. **Cold start is the static rule.** Below N observations for a
   `(model, lead)` pair, uniform weights and section 3.1's rule. No partial
   learning on 4 samples.
3. **Explainable, always.** Expose the weights as data
   (`{"arome_france": 0.52, "arpege_europe": 0.21, ...}`), so the forecast card
   can show why the number is the number. Same reasoning as the arbiter
   journal: a figure nobody can explain is a regression even when it is more
   accurate.
4. **Reject bad observations.** A station outage, a gap in the hourly series,
   or a physically implausible reading poisons the residuals. Skip the day, do
   not interpolate.
5. **One station, chosen explicitly.** The reference station is a setting
   pointing at a `weather` equipment, not an inferred default. A household with
   two stations must not have the learner silently pick one.

### 4.4 Where it lives: the core, as equipment computed data

An earlier draft of this section put the learner inside the plugin. That was
wrong, and the reason is worth writing down because it is a layering rule, not
a preference.

An integration plugin's contract is to report faithfully what its source says.
It lives in the world of **devices**: what is on the network. Equipments, zones
and recipes are the engine's world: what is in the room. Calibrating a forecast
against a household sensor **joins two integrations through a user-level
notion** ("my outdoor reference"), which by construction is not integration
work. A plugin that did it would be the only integration in Sowel that knows
what an equipment is.

Technically it could: a plugin can persist state in its own
`integration.<id>.*` settings (`scoped-deps.ts:63`, writes to its own namespace
are allowed and do not emit `settings.changed`, so no reload loop), and spec 111
explicitly lets it read any device's current data (`scoped-deps.ts:246`). The
capability is there. The mandate is not.

So the learner is core, in `src/weather/`, next to `weather-aggregator.ts`. And
the objection that earlier drafts raised against core, that the calibrated value
cannot reuse the `jN_temp_max` alias the plugin owns, is not the fork it was
made out to be. It is the layering working exactly as designed:

- `j1_temp_max`, device data, owned by the plugin: **what Open-Meteo said**.
- the calibrated entry, equipment computed data: **what it means at this
  address**.

That is the same distinction spec 134 already makes when it adds
`<alias>_max_today` on top of a raw temperature binding, and spec 153 when it
derives `speed` from relay states. `registerComputedDataProvider` takes a list
and already has two entries (`src/index.ts:278`); this is the third. What is
left is a naming decision for the calibrated aliases, not an architectural one.

The consequence is a simplification. Earlier drafts wanted two additions to the
plugin surface, an equipment-typed setting and a read-only history accessor in
`PluginDeps`. **Both disappear.** The core already holds the database, the
InfluxDB history, the equipments and the user's choice of reference. Nothing in
`PluginDeps` changes, `IntegrationSettingDef` is untouched, and there is no
isolation question to argue about.

The plugin therefore stays a plugin: sections 3.1 to 3.3, fetch the models,
publish what they said, and nothing else.

## 5. Measured on the production installation

Everything below is a walk-forward simulation on the real installation:
92 days of archived per-model forecasts from the Previous Runs API against
2 149 hourly observations from the household's own station, pulled read-only
from `sowel-hourly`. At every hour the learner only ever sees past data; the
first 21 days are warm-up and are excluded from the scores. 1 645 evaluated
hours per lead.

### 5.1 The site sits about 2 C above every model

| Local sensor                    | Mean offset vs `best_match` at 24 h |
| ------------------------------- | ----------------------------------- |
| Weather station (`temperature`) | **+2.07 C**                         |
| Heat pump outdoor probe         | +1.90 C                             |
| Pool heat pump outdoor probe    | +0.96 C                             |

Three sensors, three vendors, all warmer than six independent models. They
agree with each other to within about 1 C (station versus heat pump: 0.16 C).
The AROME grid cell is at 535 m and the house is at 530 m, so this is not an
elevation artefact, and it is not one badly sited probe. It is a local warm
anomaly that a 2.5 km grid cell does not resolve.

The offset has a strong diurnal structure. Bias of `best_match` at 24 h lead,
by local hour (forecast minus station):

| h        | 00   | 04   | 08   | 10  | 14   | 18       | 21       | 23   |
| -------- | ---- | ---- | ---- | --- | ---- | -------- | -------- | ---- |
| bias (C) | -2.5 | -1.5 | +0.1 | 0.0 | -2.0 | **-4.1** | **-4.3** | -3.0 |

Mid-morning the models are right. Evenings they are 4 C too cold relative to
what this household's sensors read. Note also the extremes: over the 92 days the
models topped out at 36.6 C where the station saw 39.8 C and the heat pump
probes 42 C. The gap is widest exactly in the regime where a cooling decision
matters.

### 5.2 What the correction is worth

Out-of-sample MAE and RMS in C, with the per-hour-of-day bias variant:

| Lead | Today (`best_match` raw)         | Debiased    | Debiased + model selection | Gain      |
| ---- | -------------------------------- | ----------- | -------------------------- | --------- |
| 24 h | MAE 2.45 / RMS 3.10 / bias -1.98 | 1.82 / 2.36 | **1.35 / 1.82**            | **-45 %** |
| 48 h | MAE 3.16 / RMS 3.73 / bias -2.61 | 1.80 / 2.30 | **1.64 / 2.07**            | **-48 %** |
| 72 h | MAE 3.23 / RMS 3.79 / bias -2.62 | 1.92 / 2.42 | **1.51 / 1.99**            | **-53 %** |

Three readings of that table.

**The bias correction carries most of the gain**, as predicted in 4.2: it alone
takes 48 h from 3.16 to 1.80. Per-model selection and weighting add a further 5
to 20 points on top. At 24 h the model term is larger than section 4.2 assumed,
so the claim "debiasing is the whole story" would be too strong; it is roughly
two thirds of it.

**Per-hour-of-day bias beats a single scalar here**, which is the opposite of
what the same experiment showed at an arbitrary grid point 100 km away
(scalar 1.69 versus per-hour 1.35 at 24 h). The 24 EWMAs each see 24 times
fewer samples, so they are noisier, and they only pay off where the bias has a
real diurnal shape. It does here. That argues for keeping both estimators and
letting the walk-forward score pick, rather than hard-coding either.

**The blend does not always beat the best single debiased model.** At 48 and
72 h with a scalar bias, best-single won (1.76 and 1.87) over the
inverse-variance blend (1.88 and 1.95). That is the guardrail of 4.3.1 firing
on real data before a line of production code exists, and it is the reason the
guardrail is not optional.

### 5.3 Verdict

A forecast that is 2 C off on average and 4 C off in the evening is not a
forecast a recipe can compare against a local sensor. Halving that error, with
an EWMA and a weighted mean, is comfortably worth the 2 to 3 days of section
4's phase. The measurement also re-scopes section 3: the multi-model ladder is
worth having, but on this installation it is second order next to learning what
the site does to the numbers.

Caveat: 92 days of summer, at one installation. The learned bias is a summer
bias, the EWMA will track the seasonal drift, and none of these figures should
be quoted as a general result. What generalises is the method, not the 45 %.

## 6. Solar production forecast

Section 3.3 published hourly irradiance without saying what would consume it.
This section is that consumer, measured on the same installation: archived
Open-Meteo forecasts against the household's own production meter, walk-forward,
learning from the past only.

### 6.1 Two traps that had to be cleared first

**The array changed size mid-period.** The household added about 1 kW at the
start of August. It shows up unambiguously in the data as a step in the daily
production / daily GHI ratio: stable around 2.55 through July, 3.6 from
**4 August** onward. Everything below is therefore evaluated on the
constant-capacity window, 26 May to 3 August, 70 days. A first pass that ignored
the step inflated every error by roughly a third and produced a nonsense array
orientation.

**`direct_radiation` is on the horizontal plane, not normal to the sun.** Using
it directly as DNI under-estimates the plane-of-array irradiance at low sun
angles, which manufactured a fake efficiency peak at 18 h. The conversion is
`DNI = direct_radiation / sin(elevation)`, guarded below a few degrees of
elevation. Any implementation of this must get that right or ask Open-Meteo for
`direct_normal_irradiance` instead.

### 6.2 The model

Geometry is known, not learned. The household knows its tilt and azimuth
(here 35 degrees, due south, free-standing in a field), and asking is both more
accurate and more honest than fitting: over a single summer the three geometry
regressors are badly collinear, so a fit predicts well while returning
meaningless angles (12 degrees and north, on data whose truth is 35 degrees and
south).

```
POA  = DNI * max(0, cos theta) + diffuse * (1 + cos tilt) / 2
P(h) = gain * shape(h) * POA * (1 + gamma * (T - 25))      gamma = -0.004 / C
```

`gain` is the array's effective capacity, one number. `shape(h)` is one
coefficient per local hour, refit on a rolling 45-day window. Thirteen numbers
in total, refit nightly, plain arithmetic.

| Model (constant-capacity window) | Hourly MAE | Hourly RMS |
| -------------------------------- | ---------- | ---------- |
| Single global coefficient        | 178 W      | 297 W      |
| **With the hourly shape**        | **158 W**  | **291 W**  |

Daily energy: **MAE 1.19 kWh on a 17.9 kWh/day average, 6.7 %**. 73 % of days
land within 10 %, 93 % within 20 %, worst day 5.1 kWh.

### 6.3 What `shape(h)` actually measures

It is not a fudge factor, it is a readable diagnosis of the site. Normalised to
its best hour, on this installation:

| Local hour | 08       | 09  | 10  | 11  | 12  | 13  | 14  | 15  | 16  | 17  | 18  | 19  | 20       |
| ---------- | -------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | -------- |
| Efficiency | **53 %** | 79  | 89  | 93  | 89  | 85  | 85  | 86  | 88  | 93  | 100 | 92  | **61 %** |

Two features, both physical. The collapse at 08 h and 20 h is **tree shading at
low sun angles**, which the household confirmed independently. The gentle 85 %
dip from 13 h to 15 h is the **thermal derating** of the panels at the hottest
hours, and 15 % is the textbook order of magnitude, so the explicit `gamma` term
above only captures the day-to-day variation around it.

A model that asked the user to declare their shading would be unusable. A model
that measures it costs thirteen numbers.

### 6.4 Separating gain from shape pays for itself

The same profile, normalised, is identical before and after the +1 kW: only the
scale moved. That is worth exploiting, because a household that adds panels
should not wait 45 days for the rolling window to catch up.

| After the 4 August capacity change       | Hourly MAE |
| ---------------------------------------- | ---------- |
| Old profile, gain not recalibrated       | 523 W      |
| Old profile, gain recalibrated on 2 days | 264 W      |
| Old profile, gain recalibrated on 3 days | 253 W      |

So: keep `shape(h)` on its slow window, and detect a step in the
production / POA ratio to re-estimate `gain` alone. Recovery in two or three
days instead of six weeks. The same detector protects against the opposite case,
a panel failing or an inverter dropping out, which is a monitoring feature the
household gets for free.

### 6.5 The irradiance forecast is not the bottleneck

Feeding the model the analysis irradiance instead of the 24 h forecast barely
moves the error. Open-Meteo's 24 h irradiance forecast has a 35 W/m2 MAE on a
505 W/m2 mean, about 7 %. Nearly the whole error budget is in the
irradiance-to-production conversion.

Consequence for section 3: **no multi-model and no ensemble irradiance is needed
for a useful PV forecast.** A single model's hourly `direct_radiation` and
`diffuse_radiation` is enough, and AROME HD carries neither (use
`meteofrance_arome_france` at 2.5 km, or any global model).

### 6.6 Placement, and what it does not do

Same split as section 4: the plugin publishes what the source said, the core
learns what it means here. Solar geometry needs no new dependency, `suncalc` is
already one (`src/zones/sunlight-manager.ts:1`) and `getPosition()` returns
altitude and azimuth. Tilt, azimuth and peak power become plugin-independent
settings on the production equipment.

This is Phase 4 of `2026-08-23-arbiter-predictive.md` and it stays inert until
something consumes it. A 6.7 % daily energy forecast answers "will there be
surplus tomorrow afternoon", which is what the Phase 6 daily planner needs. It
does not answer "will the surplus hold for the next twenty minutes", which is
what the Phase 5 engage gate needs and which is a question about clouds at the
minute scale. This is a **planning** input, not a control input.

## 7. PV health and performance tracking

The capacity-step detector of 6.4 was introduced to protect the forecast. Turned
around, it is a monitoring feature in its own right. Everything below was
validated against the production installation's own history.

The design constraint that shapes it: **per-panel data cannot be the
foundation.** On the reference installation it exists only because the owner
reverse-engineered the APsystems protocol, and it covers six of eight panels,
the two most recent micro-inverter channels speaking a protocol the hack does
not handle. Most installations have a production meter and nothing else. So the
feature is two tiers, and tier 1 must stand alone.

### 7.1 Tier 1: the aggregate detector, available everywhere

Inputs: one production meter, plus the declared peak power, tilt and azimuth of
7.4. Nothing else. The quantity tracked is the performance ratio, measured
production over the POA model of 6.2.

The whole question is sensitivity, and it is a matter of noise. Measured on the
constant-capacity window:

| Hours used for the ratio       | Days kept | Day-to-day noise | Step detectable at 3 sigma over 3 days |
| ------------------------------ | --------- | ---------------- | -------------------------------------- |
| All daylight, all weather      | 69        | 10.5 %           | 18.2 %                                 |
| 10 h to 16 h local             | 69        | 10.3 %           | 17.8 %                                 |
| 10 h to 16 h, cloud < 30 %     | 54        | 7.2 %            | 12.5 %                                 |
| **10 h to 16 h, cloud < 15 %** | **51**    | **6.8 %**        | **11.8 %**                             |

Restricting to clear midday hours cuts the noise by a third, and it costs little:
51 of 69 summer days still qualify. Winter will be slower, and the feature should
say so rather than pretend otherwise.

Against that noise floor, on this 8 x 500 Wc array:

- One panel lost: 12.5 % of the array, detected in about **3 clear days**.
- A whole micro-inverter lost (two channels): 25 %, detected in **1 clear day**.
- Progressive soiling: visible as a drift rather than a step, which is why the
  baseline has to be a slow-moving reference and not a fixed constant.

That is a real monitoring feature on an installation with no per-panel data at
all, which is the common case.

### 7.2 Tier 2: peer comparison, when per-panel data exists

Where it exists it is much sharper. Comparing each panel to the median of its
peers, four of the six monitored panels sit within 1.5 % of their own normal,
day after day, for two months. Against that noise floor the incident is
unmissable:

> **2026-07-05, INV_0.** PV_03 at 0 W for nine consecutive hours (08 h to 16 h
> UTC) while its peers ran at 450 to 500 W, and PV_04, the other channel of the
> same micro-inverter, degraded to 40 % over three of them.

The household confirmed independently that a micro-inverter had lost a channel.
The signature is in the history, with a date, and nothing surfaced it at the
time.

The grouping needed to attribute the fault to INV_0 rather than to two unrelated
panels is **already in the data model**: PV_03 and PV_04 bind to the same device,
as do PV_05/PV_06 and PV_07/PV_08. Nothing to declare.

### 7.3 A naive peer rule would cry wolf every day

The same scan surfaces two patterns that are **not** faults:

| Panel | When                                              | Level               | What it is   |
| ----- | ------------------------------------------------- | ------------------- | ------------ |
| PV_03 | every morning 08-09 h UTC, mid-June to early July | 37 to 49 % of peers | tree shading |
| PV_08 | every evening 16 h UTC, June through August       | 72 to 88 % of peers | tree shading |

"A panel below 90 % of its peers is faulty" would have fired on 27 of 70 days.
The baseline cannot be "equal to its peers": it has to be **the panel's own
learned normal for that hour**, and the alert is a departure from it. Shading is
stable and repeats; a fault breaks a pattern. Same discipline as section 4.

### 7.4 The two tiers measure different things, and must not be mixed

Tier 1 is blind to nothing that affects the whole array, and that is exactly
what tier 2 cannot see: peer comparison moves its own median, so uniform soiling,
snow, or the aggregate low-sun shading of 6.3 are invisible to it. Conversely
tier 1 needs three clear days where tier 2 needs one hour.

But they must not be cross-validated against each other. On this installation
the sum of the six monitored panels is 121 % of the aggregate meter before the
August expansion and 90 % after, even with the impossible readings rejected.
Those are different physical quantities: DC at the micro-inverter input against
AC at the meter, over a partial subset. Each tier tracks its own baseline.

### 7.5 What the user should declare, and what each field buys

| Field               | Where                               | What it unlocks                                       |
| ------------------- | ----------------------------------- | ----------------------------------------------------- |
| Peak power (Wc)     | the array, and per panel when known | Tier 1 entirely; makes impossible readings rejectable |
| Tilt and azimuth    | the array, per panel if they differ | The POA model of 6.2, hence the forecast and tier 1   |
| (inverter grouping) | **not declared**                    | Already known from the device binding                 |

Peak power matters more than it looks. This installation's history contains four
physically impossible readings, 12 kW to 31 kW on panels rated 500 Wc, always
both channels of one micro-inverter at once (INV_0 on 2026-08-10, INV_1 on
2026-07-03). They are in the stored history now and would poison any model
fitted on it. A declared 500 Wc makes them a one-line rejection.

Declaring geometry is the conclusion of 6.2: over a single season a fit returns
confident nonsense (12 degrees facing north where the truth is 35 degrees facing
south). Ask, do not infer.

### 7.6 What it should expose

- A performance ratio for the array, and per panel and per inverter where tier 2
  is available, always shown against its learned normal rather than as a bare
  number.
- An alert on departure from that normal, attributed to the **inverter** when
  both its channels move together, which is the 2026-07-05 signature and what
  the owner can actually act on.
- A shading profile per panel, a by-product of the learned baseline that costs
  nothing extra and tells the household something no datasheet can.
- **Explicit coverage.** Tier 2 monitors whatever reports; on this installation
  that is six panels of eight. A health feature that silently watches a subset
  is worse than one that says which panels it cannot see.

## 8. Phasing

**v2.0, plugin only, no core change.** Model ladder, ensemble rain probability,
`jN_temp_max_spread`, `jN_confidence`, `model_used`. Ships as a plugin release
plus the mandatory registry SHA bump. Reversible: a `models` setting back to
`auto` restores today's behaviour exactly. Effort: about a day. Risk: low, the
existing aliases are untouched.

**v2.1, plugin plus a small core change.** `irradiance_48h` json series, and the
forecast card showing confidence and source model. Effort: half a day plugin,
half a day UI. Risk: low. This closes Phase 3 of the arbiter roadmap.

**v2.2, core only, the learner of section 4.** Per-model bias and skill against
the user-selected reference equipment, exposed as computed data, calibrated on
day one from the 90 days already in `sowel-hourly`. No plugin change, no plugin
API change. Own spec. Effort: 2 to 3 days. Risk: low in blast radius
(a wrong weight degrades a forecast, never a relay), which is precisely why this
is a better place to prove the learn-from-the-installation pattern than the
control loop is.

**v3.0, the solar production forecast of section 6.** Plugin side: add
`direct_radiation` and `diffuse_radiation` to the hourly series of v2.1. Core
side: the per hour-of-day model, refit nightly on a rolling 45-day window,
exposed as an hourly expected-production curve. Effort: half a day plugin, about
2 days core. Own spec, and it is Phase 4 of the arbiter roadmap, so it stays
inert until something consumes it.

**v3.1, PV health and performance of section 7.** Peer ratio plus absolute
performance ratio, both on the baselines the forecast already learns, alerts
attributed per inverter, shading profile as a by-product. Requires the declared
peak power and geometry of 7.4. Effort: about 2 days on top of v3.0, since the
POA model and the learned baselines are shared. Arguably the most immediately
useful thing in this document for a household with panels: it found a real
micro-inverter fault in existing history, after the fact.

**Then, and only then.** `smart-cooling` gating its pre-cooling on
`j1_confidence`, and the arbiter's Phase 5/6 consuming the production curve.
Separate specs, inert until someone writes them.

## 9. What this deliberately is not

- **Not a second provider.** Multi-model gives meteorological confidence, not
  service redundancy: every call still goes to Open-Meteo. Adding
  Meteo-France's own API (AROME via the public data portal) would give
  redundancy, at the cost of an API key and a second parser. Not worth it until
  Open-Meteo actually proves unreliable.
- **Not a model comparison UI.** `releve-meteo` shows four curves because
  comparing models is its product. Sowel's product is a decision. Four curves in
  a home automation UI is noise; one number plus a confidence marker is not.
- **Not sub-hourly nowcasting.** `meteofrance_arome_france_15min` exists and is
  tempting for PV, but the arbiter roadmap already ruled sub-15-minute
  nowcasting out of scope, and its horizon is 6 hours.
- **Not a vendored copy of `releve-meteo`.** It is MIT, so its WMO code mapping
  and model list can be referenced with credit. There is nothing else in it that
  a backend plugin needs.
