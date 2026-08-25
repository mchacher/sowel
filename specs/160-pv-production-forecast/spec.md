# Spec 160 — PV production forecast

## Context

Sowel knows what the panels produced. It has no idea what they will produce.
Every decision that would benefit — running the washing machine tomorrow
afternoon, heating the pool on the right day, and eventually the arbiter's daily
planner — is taken blind or by looking at a weather icon.

The design and every figure below were measured on a production installation
over 92 days, walk-forward, learning only from the past:
`docs/planning/2026-08-24-weather-multi-model.md`, section 6.

| Model                            | Hourly MAE | Daily energy MAE     |
| -------------------------------- | ---------- | -------------------- |
| Persistence (yesterday)          | 271 W      | 2.91 kWh (15.3 %)    |
| Single-plane physical model      | 310 W      | 2.96 kWh (15.5 %)    |
| NNLS over a dictionary of planes | 323 W      | 3.24 kWh (17.0 %)    |
| **Retained: per hour-of-day**    | **158 W**  | **1.19 kWh (6.7 %)** |

73 % of days land within 10 % of the actual energy, 93 % within 20 %.

## Goals

1. Publish an hourly expected-production curve out to J+5, refreshed at every
   weather poll.
2. Keep what was forecast, so the household can see forecast against actual and
   judge whether the number deserves to be trusted.
3. Learn the installation rather than interrogate the owner: shading, soiling
   and ageing are measured, never declared.
4. Take a declared change of the array without throwing away what was learned
   about the site.

## Non-Goals

- **Feeding the arbiter.** Phases 5 and 6 of
  `docs/planning/2026-08-23-arbiter-predictive.md` do not exist. This is a
  planning input for a human, and it stays inert until something consumes it.
- **Sub-hourly nowcasting.** A 6.7 % daily forecast answers "will there be
  surplus tomorrow afternoon". It does not answer "will the surplus hold for
  twenty minutes", which is a question about clouds at the minute scale.
- **Per-panel health.** Peer comparison and fault attribution are section 7 of
  the planning doc and their own spec.
- **Fitting the array geometry.** See FR2.

## Functional Requirements

### FR1 — Declared array, as a list of planes

A production equipment carries an optional `solarProfile`, following the exact
pattern of `energyProfile` (spec 140): a JSON column on `equipments`, whose
presence is what enables the feature.

```ts
interface SolarPlane {
  tiltDeg: number; // 0 = flat, 90 = vertical
  azimuthDeg: number; // 180 = due south
  peakWc: number; // nameplate power of the panels on this plane
}
interface SolarProfile {
  planes: SolarPlane[];
}
```

**A list of planes, not a list of panels.** The panel count adds nothing the
total peak power does not already carry: the learned `gain` absorbs the real
capacity. What genuinely changes the physics is panels facing different ways,
and that is the one case a linear model cannot express — two plane terms summed
with free coefficients collapse into one, because the non-linearity is the
`max(0, cos theta)` clipping of a panel whose sun has gone behind it. Each plane
is therefore clipped on its own and the results summed, weighted by peak power.

### FR2 — Geometry is declared, never fitted

Asking is both more accurate and more honest. Over a single season the three
geometry regressors are badly collinear: a fit predicts well while returning
meaningless angles. Measured on the reference installation, the fit returned
**12 degrees facing north** where the truth is 35 degrees facing south.

### FR3 — The model

```
DNI  = direct_radiation / sin(elevation)         guarded below ~3 degrees
POA  = sum over planes of  peakWc_i / peakWc_total
                           * [ DNI * max(0, cos theta_i)
                               + diffuse * (1 + cos tilt_i) / 2 ]
P(h) = gain * shape(h) * POA * (1 + gamma * (T - 25))     gamma = -0.004 / C
```

`gain` is one number, `shape(h)` one coefficient per local hour, both refit
nightly on a **rolling 45-day window**. Thirteen numbers for a single-plane
array, plain arithmetic, no ML runtime.

**`direct_radiation` is on the horizontal plane, not normal to the sun.** Using
it as DNI under-estimates the plane-of-array irradiance at low sun and
manufactured a fake efficiency peak at 18 h during the study. This is the single
easiest thing to get wrong here.

**The window must forget.** 45 days beat fitting on all history (158 W against
201 W): the sun path moves, and coefficients learned in May are wrong in August.

### FR4 — `shape(h)` measures the site, and is worth showing

It is not a fudge factor. Normalised to its best hour on the reference
installation:

| Local hour | 08       | 10  | 12  | 14  | 16  | 18  | 20       |
| ---------- | -------- | --- | --- | --- | --- | --- | -------- |
| Efficiency | **53 %** | 89  | 89  | 85  | 88  | 100 | **61 %** |

The collapse at 08 h and 20 h is tree shading at low sun, confirmed
independently by the owner. The 85 % dip from 13 h to 15 h is thermal derating
at the hottest hours, the textbook magnitude. A model that asked the household
to declare its shading would be unusable; one that measures it costs thirteen
numbers.

### FR5 — Forecast horizon and refresh

Hourly, from now to the end of J+5, recomputed at every weather poll (default
every 30 min). Verified against the live API: `direct_radiation`,
`diffuse_radiation` and `temperature_2m` are complete over 120 hourly points at
4.4 KB.

Accuracy degrades with the horizon and the UI must not pretend otherwise: the
curve carries the forecast age and, past 48 h, is presented as an outlook.

### FR6 — Forecast against actual, kept

Every published curve point is persisted with the lead time it was issued at, so
that once the hour has passed the forecast can be compared with what the meter
actually recorded. Without this the forecast is a snapshot overwritten at each
poll and its accuracy can never be stated, now or later.

Retention aligns with `ENERGY_RETENTION.hourly`, **2 years**, so one June can be
compared with the next and soiling or ageing can be seen drifting across a full
season.

### FR7 — A capacity change is declared, not guessed

When the array changes, the owner updates the declared peak power. That edit is
the signal: saving a profile whose total peak power differs from the one the
model was fitted on re-estimates **`gain` alone** and leaves `shape(h)` on its
slow window.

That split is what makes it cheap, and it is measured. On the reference
installation the normalised `shape(h)` was **identical before and after** a
+1 kW addition; only the scale moved:

| After the capacity change     | Hourly MAE |
| ----------------------------- | ---------- |
| No recalibration              | 523 W      |
| `gain` re-estimated on 2 days | 264 W      |
| `gain` re-estimated on 3 days | 253 W      |

A **manual recalibration action** is also exposed for the case where nothing was
declared but something changed anyway — a panel cleaned, a shading branch cut.

No automatic step detection. It would only earn its keep on the _undeclared_
loss, an inverter dropping or a panel failing, and that is the absolute
performance ratio of the health feature (planning doc section 7), which watches
the same ratio for that exact purpose. Duplicating it here would mean two
detectors on one signal, disagreeing at the edges.

The consequence is stated plainly rather than hidden: an owner who changes the
array and does not update the profile gets a forecast that drifts until the
45-day window catches up on its own. The panel therefore shows the declared peak
power next to the curve, so a stale declaration is visible where it matters.

### FR8 — Impossible readings are rejected

The reference installation's history contains four physically impossible
readings, 12 kW to 31 kW on panels rated 500 Wc, always both channels of one
micro-inverter at once. They are stored and would poison any fit. A sample above
the declared total peak power, with a margin, is excluded from the fit and
logged.

### FR9 — Declaring the array, in the UI

The profile is useless if nobody can enter it, and it is the one thing the
feature genuinely asks of the household. It follows the pattern spec 140 already
established for `energyProfile`: a collapsible panel on the production
equipment's page, with a toggle that enables the feature, exactly like
`EnergyManagementPanel`.

One row per plane, plus **Add a plane**. Each row asks three things:

| Field       | Input                                                                      | Help                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orientation | The eight cardinals (N, NE, E, SE, S, SW, W, NW) plus a free degrees field | Nobody thinks "180". The buttons set the degrees, the field covers anything in between. All eight, not just the sunny ones: north-facing and east/west arrays exist and the model handles them |
| Tilt        | Degrees, 0 to 90                                                           | Plain-language anchors: 0 flat, 30 to 35 a typical roof, 90 a wall, a fence or a balcony rail                                                                                                  |
| Peak power  | Wc                                                                         | The nameplate sum for that plane, e.g. 8 panels of 500 Wc = 4000                                                                                                                               |

A single-plane array, which is the common case, is therefore three fields and no
mention of the word plane. **Add a plane** only appears once the first is filled,
so an east/west roof is possible without making everyone else read about it.

What the form must **not** ask: the number of panels, which adds nothing the
peak power does not carry, and the shading, which FR4 measures.

Validation refuses a tilt outside 0 to 90, an azimuth outside 0 to 360 and a
peak power at or below zero, naming the offending field. A profile whose total
peak power is zero is treated as absent rather than saved broken.

The panel states plainly what the declaration buys, because an owner has no
reason to guess: it enables the production forecast, and the figures are only as
good as the geometry given.

### FR10 — No binding to create

The irradiance series is read directly from the `DeviceManager` by key and
category, without a data binding and without an equipment. Bindings attach
device data to something a household looks at; this is a computation input.

Nothing therefore has to be bound by hand after the plugin update, which is the
friction issue #707 describes. The array declaration of FR9 is the only thing
this feature asks of the owner.

### FR11 — Where it lives

Computed data on the **existing production equipment**, plus a dedicated panel
on its page. Not a new equipment type.

The analogy with `weather` / `weather_forecast` does not hold: those are
separate because they come from different sources, hence different devices. Here
the forecast is about the same object as the measurement and is derived from
that object's own history. A household has a PV installation, not a PV
installation and a PV forecast. A `pv_forecast` equipment would also be an object
the creation form cannot build, since a device is chosen there and this one has
none.

## Acceptance Criteria

- [x] An equipment with no `solarProfile` is untouched: no forecast, no storage,
      no panel
- [x] The irradiance series is consumed with no data binding created anywhere
- [x] With a profile, an hourly curve to J+5 is exposed and refreshed each poll
- [x] Several planes are summed with per-plane clipping, verified on a synthetic
      east/west array
- [x] `gain` and `shape(h)` refit nightly on a 45-day window
- [x] Forecast points are persisted with their lead time and readable back
- [x] Saving a profile with a different total peak power re-estimates `gain`
      and leaves `shape(h)` untouched
- [x] A manual recalibration re-estimates `gain` immediately
- [x] The eight cardinal shortcuts each set the expected azimuth
- [x] Samples above declared peak power are excluded from the fit and logged
- [x] The declaration form creates, edits and removes planes, with cardinal
      shortcuts for the orientation
- [x] Validation refuses an out-of-range tilt, azimuth or peak power, naming the
      field
- [x] The panel shows the curve, forecast against actual for past days, and the
      rolling accuracy
- [x] Unit tests cover every scenario of the plan's test plan

## Edge Cases

| Case                                                           | Expected                                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| No `solarProfile`                                              | Feature inert, nothing computed or stored                                                                                                     |
| Profile declared but no production history yet                 | No fit; the clear-sky physical estimate is published with the accuracy shown as unknown                                                       |
| Fewer than N days in the window                                | No fit, forecast withheld rather than published from noise                                                                                    |
| Irradiance series missing (plugin not updated, or poll failed) | Last curve kept with its age shown; no new points persisted                                                                                   |
| Sun below the horizon                                          | POA is zero by construction, production forecast zero, not null                                                                               |
| A plane declared with an absurd tilt or azimuth                | Rejected at validation with a message naming the field                                                                                        |
| Total peak power zero or missing                               | Profile invalid; treated as absent                                                                                                            |
| Meter reports a sample above peak power                        | Excluded from the fit, logged, still shown on the actual curve                                                                                |
| Array changed but the profile not updated                      | The forecast drifts until the 45-day window catches up; the declared peak power is shown beside the curve so the stale declaration is visible |
| Profile saved with the same peak power as before               | No `gain` reset; an edit to tilt or azimuth alone does not throw away a good fit                                                              |
| Equipment deleted                                              | Its forecast state and stored points go with it                                                                                               |
