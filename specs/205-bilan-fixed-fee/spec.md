# Spec 205 — Fixed fee and price changes on the Bilan

## Context

Spec 202 gave every tariff version a fixed fee (`fixedFeeYear`, € per year including tax) and a subscribed
power, and spec 203 fills them from the price file. The Bilan (spec 200) still shows the consumption alone,
and its method card states one pair of prices although a period may now cross a price change.

The maintainer asked (2026-11-11) to add the fee to the Bilan, clearly apart from the consumption cost. This is
the lot « Fixed fee and change markers on the Bilan » of spec 202's split.

## Goals

1. The Bilan shows what the subscription cost over the period, apart from the consumption, and the total of the
   two.
2. A period crossed by a price change says so: in the chart, and in the method card with the prices of each
   part.

## Non-Goals

- No fee in the comparisons (projection, previous year, 7-day average): they compare consumption.
- No fee in the chart bars, the by-usage table, the arbiter or solar tiles, or on the Consumption page.
- No fee on the day view (one day of subscription is not a useful figure).
- No change to how consumption is priced (spec 202).

## Functional Requirements

### FR1 — Fee of a period

For each local day of the period from its first day to the earlier of its last day and today, the fee of the
day is the `fixedFeeYear` of the version in force that day divided by the number of days of that calendar year.
The fee of the period is the sum, rounded to the cent for display only.

A day whose version has no fee counts nothing and is reported as without fee. When no day of the period has a
fee, the Bilan shows no fee.

### FR2 — Prices over the period

The response lists the versions in force over the period, oldest first, each with the span of days it covers
inside the period (clamped to the period), its prices, its fee and its power.

### FR3 — Bill card (month and year)

Under the HP/HC line, after a separator, the card shows:

- « Abonnement » with the power when known (« Abonnement 9 kVA »), the amount, and a caption « Part fixe au
  prorata, N jours » (N the days counted);
- « Total avec l'abonnement », consumption plus fee.

The headline stays the consumption cost. When some days have no fee, the caption says « dont N jours sans
abonnement renseigné » and links to the prices in Settings.

### FR4 — Change markers

- Month view: a dashed vertical marker on the day a new version starts, labelled with the date in the tooltip
  area or the axis (« Nouveaux prix »).
- Year view: the same on the month a new version starts.
- Day view: none (versions start at midnight).
- The method card lists each part: « Du 1er au 31 juillet : HP 0,2065 € / HC 0,1578 € par kWh, abonnement
  …€ par an » then the next one. One version over the whole period keeps today's single sentence, plus the fee.

## Acceptance Criteria

- [ ] Month of 31 days, one version at 240 €/year in a non-leap year: fee = 31 × 240 / 365.
- [ ] A month crossed by a change of fee on day 16: the sum of both parts, each at its own daily rate.
- [ ] The current month counts the days up to today included; a future period counts nothing.
- [ ] A version without fee: its days are counted as without fee; no fee at all: no fee block.
- [ ] Year view: days of the year up to today, each at the rate of its year length (366 in 2028).
- [ ] The response lists the versions of the period with clamped spans; the chart marks a change inside the
      period, never the first part.
- [ ] The headline, comparisons, chart bars and by-usage figures are unchanged.

## Edge Cases

- A version whose start date is after today inside the current period: no fee is counted beyond today, but the
  version is listed (its span starts in the future) and marked.
- A period before the first dated version: the version without date covers it.
- The version without date has no fee (seeded from `energy.tariff`): its days are « sans abonnement renseigné ».
- Daylight saving: days are local calendar days, not 24-hour slices.

## Docs Delta

| Page (EN and FR)                             | Change                                                              |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `docs/user/energy.md` + `.fr.md`             | Bilan: the fee line, the total, the markers, the method card        |
| `docs/technical/api-reference.md` + `.fr.md` | `/energy/bilan`: `fee`, `priceSpans`                                |

Screenshots retaken: the Bilan screenshots of `docs/user/energy`, if the bill card is in the frame.
