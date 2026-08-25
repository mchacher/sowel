# Spec 161 — Fit the PV model from existing history

## Problem

Spec 160 learns a household's array from production it observes going forward.
`MIN_SAMPLES` is 120 usable daylight hours, so roughly **twelve days** pass
between declaring an array and seeing a real forecast. In the meantime the panel
shows the clear-sky estimate, labelled provisional, which reads high.

Spec 160's own text calls this out: "eleven days of an empty panel is
indistinguishable from a broken feature". The stand-in helps, but the household
has already been producing for months and Sowel already has that history.

## What this changes

The model can be fitted **immediately** from production history the installation
already holds, instead of waiting for new samples to accumulate.

Measured on the reference installation, on days the model had never seen:

| Fit                                        | Hourly error                         |
| ------------------------------------------ | ------------------------------------ |
| From history, bounded to the current array | **186 W**                            |
| From history, spanning a capacity change   | 325 W                                |
| No model at all (clear-sky stand-in)       | not comparable, reads high by design |

Over the same test period the daily total came out at 101.7 kWh against 100.1
recorded, 1.6 % apart.

## The bound is the whole design

The reference installation gained 1 kWc on 2026-08-04. Fitted across that date
the gain lands at 3.19, describing neither the array before (3.02) nor after
(3.80), and the error nearly doubles. A backfill that simply takes everything
available is worse than one that takes less.

Two bounds apply, and the shorter wins:

- **45 days**, the same rolling window the nightly refit uses. Measured on six
  weeks of summer with no hardware change, a six-week-stale shape cost 149 W
  against 101 W for a current one — the shape moves with the season, so reaching
  further back is not free.
- **Since the array last changed**, which only the household knows. Spec 160
  already holds that "a capacity change is declared, not guessed"; this is the
  same principle applied backwards in time.

Automatic detection of the step is explicitly **out of scope**. It was
considered and rejected for spec 160, and the measurement above supports that:
the cost of guessing wrong is the full 325 W, while asking costs one optional
date field.

## Requirements

### FR1 — The array declaration carries an optional "unchanged since" date

`SolarProfile` gains `since?: string` (ISO date, no time). Empty means "as far
back as the window reaches". It is only ever used to bound a backfill; the
forward path ignores it.

### FR2 — Past irradiance is published by the weather plugin, not fetched by the core

The core does not call a weather API. The plugin publishes a second series,
`irradiance_history`, covering the same 45 days, **daylight hours only** (about
630 points rather than 2 200), refreshed once a day rather than on every poll.

### FR3 — Backfill is explicit, never automatic

A household action, from the panel. Running it silently on declaration would
make a model appear from nowhere with no way to tell it apart from a learned
one, and would fire before the owner had a chance to state FR1's date.

### FR4 — Backfill pairs the same way the live path does

Production is read hourly from the downsampled bucket, paired with the irradiance
for that hour, projected onto the declared planes by the existing geometry. The
rows written to `pv_forecast_sample` are indistinguishable from live-collected
ones, because they are the same measurement of the same hours.

### FR5 — A backfill states what it did

Number of hours paired, the window actually used, and why it was bounded. A
household that declared a date last week and gets 9 days of history must be able
to see that is what happened.

### FR6 — Backfill is repeatable, idempotent, and never destructive on failure

Running it twice must not double-count. Rows are upserted on
`(equipment_id, at)`, the same key the live path uses.

Samples recorded before the window are dropped — they describe hardware that is
gone, and the nightly refit would otherwise keep fitting on them — but **only
once a fit over the window alone has succeeded**. The order matters: deleting
first means a date typed as one day instead of one year costs every accumulated
sample in exchange for a model the household did not get.

The fit itself runs over the window, not over everything stored. Bounding what a
run _adds_ without bounding what it _fits on_ leaves an earlier, unbounded run's
rows in the fit, and a corrected second run changes nothing at all.

## Out of scope

- Automatic capacity-change detection (see above).
- Reaching further back than the 45-day window: `-hourly` retains 90 days of
  power, but the seasonal drift measured above makes the extra 45 days
  counter-productive, and the shape would be fitted on a season that has passed.
- Backfilling the forecast-vs-actual accuracy history. Those points record what
  was _promised_ at a lead time; nothing was promised in the past, and inventing
  it would make the accuracy figure a fiction.

## Acceptance criteria

- [ ] `solarProfile.since` round-trips through the API and the UI
- [ ] The plugin publishes `irradiance_history` at most once a day, daylight only
- [ ] Backfill refuses with a clear reason when the plugin publishes no history
- [ ] Backfill refuses when the array is not declared
- [ ] The window is bounded by `since` when it is more recent than 45 days
- [ ] Hours with no production, or no irradiance, are skipped rather than zeroed
- [ ] Samples above the impossible ceiling are excluded, as in the live path
- [ ] Running backfill twice leaves the same number of rows
- [ ] A declared window too short to fit deletes nothing
- [ ] Neither side of the pairing is time-shifted (both label an hour by its end)
- [ ] A model is fitted at the end, or the reason none was is reported
- [ ] The panel reports hours paired and the window used

## Edge cases

| Case                                                        | Behaviour                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `irradiance_history` published (old plugin)              | Refused, naming the plugin update                                                                                                                       |
| No production history in Influx                             | Refused, reporting zero hours paired                                                                                                                    |
| `since` in the future, or unparseable                       | Ignored, the 45-day bound applies                                                                                                                       |
| `since` more than 45 days ago                               | Ignored, the 45-day bound applies                                                                                                                       |
| `since` so recent that fewer than `MIN_SAMPLES` hours exist | Samples are written, no model is fitted, **nothing is deleted**, and the panel says so. A mistyped date must never cost a household the history it had. |
| Influx unavailable                                          | Refused, the existing model untouched                                                                                                                   |
| A model already exists                                      | Replaced, and the capacity stamp is set to the declared value                                                                                           |
