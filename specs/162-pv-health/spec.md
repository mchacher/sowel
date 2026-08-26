# Spec 162 — Tell the household when the panels stop performing

## Problem

Spec 160 taught Sowel what a household's array should produce in any given hour.
Nothing yet notices when it stops producing it.

A failed panel or a dead micro-inverter channel is invisible on a production
meter. Output is lower, but output is lower on a cloudy day too, and nobody
watches a curve closely enough to tell a 12 % loss from weather. On the reference
installation a micro-inverter fault sat in the recorded history for weeks and was
only found afterwards, by going looking for it.

The measurement to detect it already exists. `pv-forecaster` computes, for every
daylight hour, the plane-of-array irradiance and what the array should have made
of it. Comparing that with the meter is one division.

## What this does

Once a day, compare what the panels produced with what they should have. When the
gap is clear and it lasts, say so.

That is the whole feature.

## Scope

**In.** One number per day for the whole array, a slow-moving normal to compare
it against, an alert when it departs, and a card that says what is being watched
and how quickly a fault would show.

**Out, deliberately.** Per-panel attribution. The reference installation reports
six panels of eight, and only because its owner reverse-engineered the inverter
protocol; most installations have a meter and nothing else. Building on data
almost nobody has would make the common case an afterthought. The planning note
also found that a naive peer rule cries wolf daily (section 7.3), which is a
second feature's worth of care. The cost of leaving it out is real and should be
stated plainly on the card: this tells you **that** something is wrong and how
big, never **which** panel.

## The ratio, and why it is restricted

Performance ratio = measured production / modelled plane-of-array irradiance,
over the same hours.

Restricted to **10 h to 16 h local, on hours whose direct fraction exceeds
0.75** — the share of irradiance arriving as beam rather than scattered. That
restriction is the difference between a feature and a noise generator.

The planning note reached the same conclusion using cloud cover, which the
weather plugin does not publish. Re-measured on the reference installation's
constant-capacity window using only what _is_ published, the direct fraction
turns out to be the better criterion, not a degraded substitute for one — it
measures beam availability, which is exactly what the model depends on:

| Hours used                               | Days kept | Day-to-day noise | Step detectable at 3σ over 3 days |
| ---------------------------------------- | --------- | ---------------- | --------------------------------- |
| All daylight, all weather                | 47        | 10.3 %           | 17.9 %                            |
| 10 h to 16 h                             | 47        | 9.5 %            | 16.5 %                            |
| 10 h to 16 h, direct fraction > 0.50     | 46        | 9.2 %            | 15.9 %                            |
| 10 h to 16 h, direct fraction > 0.65     | 43        | 5.9 %            | 10.3 %                            |
| **10 h to 16 h, direct fraction > 0.75** | **39**    | **4.3 %**        | **7.5 %**                         |
| 10 h to 16 h, direct fraction > 0.80     | 32        | 3.6 %            | 6.2 %                             |

0.75 is the knee. Tightening to 0.80 buys 0.7 points of noise and costs seven
days of the thirty-nine, which slows the detector more than the extra precision
speeds it.

Against a 4.3 % floor, on the reference 8 × 500 Wc array:

- one panel lost, 12.5 % of the array → about **2 clear days**
- a micro-inverter lost, both channels, 25 % → **1 clear day**
- soiling → a slow decline, now **reported** rather than absorbed: a reference
  built on a year does not quietly follow ten percent of dirt down

## Winter is close to blind, and the card must say so

Measured over sixteen months on the reference installation: **182 qualifying
days from April to September, 50 from October to March**. Eight a month in
winter, against a reference that needs thirty to exist at all.

The detector is therefore near-dormant exactly when snow and fallen leaves do
their damage. That is a property of the sun, not of the rule, and the honest
response is to state it rather than to loosen the criterion until winter appears
to work.

## Winter is slower, and the card must say so

Fewer clear midday hours means fewer qualifying days means a slower detector. A
health feature that reports the same confidence in December as in July is lying.
The card states how many qualifying days it has seen recently and what a fault of
a given size would take to confirm **now**, not in the abstract.

## Requirements

### FR1 — A daily performance ratio

For each day with enough qualifying hours, store measured Wh over modelled Wh.
A day below the threshold of qualifying hours is skipped, not stored as a low
ratio: too few clear hours is missing information, never bad performance.

### FR2 — A reference the array cannot drag down, frozen once it matters

The reference is a **high centile (80th) of the last 180 qualifying days**, not a
median of the last 20. That is not a refinement; it is the difference between a
feature and a placebo.

Validated against a real single-panel outage on the reference installation,
about eight months long, with the repair date known from the owner:

| reference                  | fault days covered | false-alert days |
| -------------------------- | ------------------ | ---------------- |
| median over 20 days        | **7 %**            | 2 %              |
| median over 60 days        | 12 %               | 2 %              |
| **80th centile, 180 days** | **91 %**           | **2 %**          |
| 90th centile, all history  | 95 %               | 10 %             |

A median follows the array down: a fault filling half the window becomes the
reference and the detector accepts it as the new normal. A fault filling a fifth
of the window cannot move an 80th centile. The measured consequence of getting
this wrong is that eight months of a dead panel go unreported.

The question the reference answers is therefore "what is this array capable of",
not "what does it typically do". A dirty fortnight must not become the standard
it is held to.

**Once an alert is raised, the normal it was raised against is frozen and
persisted.** A rolling median absorbs a sustained fault: once the bad days fill
the window the median _becomes_ the degraded level, the deficit vanishes on
paper, and the alert clears itself. Measured on the real rule, that happens after
fourteen clear days — and the household is told the panels recovered while they
are still dead. Excluding the days under assessment delays that by three days; it
does not prevent it.

### FR3 — An alert on a sustained departure, that survives a restart

Raise when the ratio sits below the normal by more than the margin across several
consecutive qualifying days. One bad day is never enough.

Resolve **only** after `ALERT_DAYS` consecutive qualifying days back above the
frozen threshold — symmetric with the raise. One day was enough at first, and
for a fault sitting near the margin a single lucky day resolved the alert,
three unlucky ones re-raised it, and the household got a raise/recovery pair
every few clear days all season. A real repair jumps the ratio by the size of
the fault and clears within `ALERT_DAYS` clear days regardless.

Two states look alike from the outside and only one is good news: performance
returned, and the detector went blind — a fortnight of overcast, a meter that
stopped reporting, a capacity change that pruned the history. Losing the ability
to measure is not recovery, and announcing it as such is worse than silence.

The standing alert is persisted, not held in memory. Sowel restarts on every
self-update: an in-memory flag re-raises the same alarm as new, and loses its
resolution for good if performance returned while the process was down.

Raised and resolved through the existing alarm events, so the notification
publishers and the zone activity feed carry them with no new plumbing.

### FR4 — The card says what it can and cannot see

Current ratio against its normal, the date it was measured, how many qualifying
days there have been recently, and the plain-language consequence stated as a
**sensitivity**: at this rate a loss of more than the margin would be confirmed
in about N days, and anything shallower is not detected at all.

Deliberately not "one panel in about three days". Naming a per-panel figure needs
the panel count, which is nowhere declared; deriving it by dividing the peak
power by an assumed wattage produces a confident fiction, and on a common 5 kWc
array it makes a single panel fall under the margin, so the card prints a dash
where a duration belongs.

When there has been no qualifying day recently the card says so, rather than
showing a three-week-old figure as though it were current.

Explicitly: this does not identify which panel.

### FR5 — Nothing new to declare

Peak power, tilt and azimuth are already declared for spec 160. This feature adds
no configuration. An installation with a declared array gets it.

### FR6 — Inert without a model

No model, no irradiance, or no declared array means the feature is silent — not
alerting, not showing a placeholder ratio computed from nothing.

## Acceptance criteria

- [ ] A qualifying day stores one ratio; a non-qualifying day stores nothing
- [ ] Clear-hour selection uses the direct fraction of the published irradiance, with no new plugin variable
- [ ] The normal follows a slow drift and does not follow a step
- [ ] An alert needs several qualifying days, never one
- [ ] The alert resolves when performance returns, and **only** then
- [ ] A fault lasting longer than the median window does not clear itself
- [ ] A restart neither re-raises the alert nor loses its resolution
- [ ] Losing the ability to measure never announces a recovery
- [ ] Alerts ride the existing alarm events
- [ ] The card states the current detection speed, from real recent days
- [ ] The card says it cannot name a panel
- [ ] Nothing is computed or alerted without a fitted model

## Edge cases

| Case                                    | Behaviour                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A run of overcast days                  | No ratios stored, no alert, the card says the detector is waiting                                                                                                                                                                                                                                                                                                                        |
| Winter                                  | Slower by construction; the card reports the slower figure rather than the summer one                                                                                                                                                                                                                                                                                                    |
| Declared capacity changes               | `capacity_changed_at` is stamped by the live trigger (peak change) and by any backfill whose declaration carries a date — even one older than the fit window, and even when the fit then fails for want of history. Pre-change health days are excluded from every judgement, and a standing alert raised against the old array is closed as monitoring being reset, never as a recovery |
| Geometry changed at constant peak power | The live trigger compares peak only and cannot see it. The documented path: declare the date and run "relearn from my history", which stamps the marker regardless of the fit window. Known limit: a second peak change while the first is still unmeasured reuses the first change's date                                                                                               |
| Meter offline for part of a day         | Those hours are absent, not zero; the day qualifies only on the hours that reported                                                                                                                                                                                                                                                                                                      |
| A physically impossible reading         | Already excluded by the declared peak power, as in spec 160                                                                                                                                                                                                                                                                                                                              |
| Model refit moves the gain              | The ratio is against the model; a refit moves both sides and must not by itself raise an alert                                                                                                                                                                                                                                                                                           |

## Where this stands against the literature

Checked after implementation against the published state of the art (pvlib /
RdTools at NREL, IEC 61724, Reno-Hansen clear-sky detection, and a 2026 Solar
Energy validation of rule-based detection on 1 089 residential systems).

**Aligned.** The "N consecutive clear days below a relative threshold" rule is
the published industrial practice for meter-level data (the 2026 study uses
3 days exactly, at 92 % precision). A high-quantile reference — "what the system
is capable of" — matches that study's 95th-centile normalisation and SLAC's
clear-sky-envelope baselines; a median of realised output mixes degraded and
healthy days, which is the failure the outage replay measured. Freezing the
reference at the raise is a recognised online approximation of change-point
segmentation. PR = production over modelled POA irradiance on clear hours is
RdTools' clear-sky workflow in simplified form, legitimate without an on-site
irradiance sensor.

**Divergent, accepted for now.** The direct-fraction > 0.75 clear-hour criterion
is a proxy for the canonical Reno-Hansen curve-shape detection, defensible at
hourly granularity where the canonical method (built for 1-10 min data) applies
poorly. The winter near-blindness is acknowledged qualitatively in the
high-latitude literature but nowhere quantified; the 50-vs-182-day measurement
here is sharper than what is published.

**Known gaps the literature would close, deliberately out of scope here:**
temperature-corrected PR (IEC 61724-1:2021 §14 — the standard mitigation for
seasonal spread, cheap: ambient temperature plus NOCT), a slow CUSUM alongside
the 3-day rule (published methods catch 2-8 % drifts in weeks; such drifts sit
under the 10 % margin forever and seep into the reference despite the freeze),
and a soiling-versus-fault discriminant (Deceglie's rate-and-recovery: an abrupt
positive jump after the episode means cleaning, not repair). Each changes what
the household is told and deserves its own measured spec.
