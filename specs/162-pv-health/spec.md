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
- soiling → a drift, not a step, which is why the normal has to move slowly
  rather than be a fixed constant

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

### FR2 — A normal that moves, and freezes when it matters

The reference is the median of recent qualifying days, not a constant. Soiling
and ageing are supposed to move it; a failure is supposed to outrun it.

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

Resolve **only** when a qualifying day comes back above the frozen threshold.
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

| Case                            | Behaviour                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| A run of overcast days          | No ratios stored, no alert, the card says the detector is waiting                              |
| Winter                          | Slower by construction; the card reports the slower figure rather than the summer one          |
| Declared capacity changes       | The normal is discarded and rebuilt, as the model's own gain is                                |
| Meter offline for part of a day | Those hours are absent, not zero; the day qualifies only on the hours that reported            |
| A physically impossible reading | Already excluded by the declared peak power, as in spec 160                                    |
| Model refit moves the gain      | The ratio is against the model; a refit moves both sides and must not by itself raise an alert |
