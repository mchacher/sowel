# Spec 200 — Energy Bilan page

## Context

Sowel prices energy in one place only: the Wh / € toggle of the Consumption page (spec 123), which shows the grid bill. Nothing says what the solar installation saved, nor what the surplus arbiter (spec 140) earned. On 2026-11-10 the maintainer asked for a page "très orienté bilan conso, jour, mois, année" and validated a mockup: <https://claude.ai/artifact/56ihpe5YxgwjEzneKHrj34> (desktop and phone).

Measured that day on the reference installation: a grid bill of 1.63 €, 1.50 € avoided by self-consumed solar, about 0.70 € of it steered by the arbiter, and no way to read any of it in the UI.

Decisions taken with the maintainer (2026-11-10):

- A new page **Bilan**, second in the Energy menu: En direct, **Bilan**, Consommation, Production. Energy still opens on En direct.
- Periods: day, month, year. No week.
- No surplus resale tile ("aucun intérêt").
- The arbiter gain is measured live from deployment on; earlier periods read "not measured yet".
- The Consumption page and its Wh / € toggle are not touched.
- The day view compares with the average of the 7 previous days.

## Goals

1. Show, for a day, a month or a year, what electricity cost (the grid bill) and what solar avoided.
2. Compare the period with a meaningful reference: the 7 previous days, the same month a year earlier with the month's projection, the comparable months of the previous year.
3. Split the period's cost by usage (sub-meters), paid versus avoided.
4. Measure and show the arbiter's gain: solar energy used by the loads it switched on, valued at the price of the moment.

## Non-Goals

- Surplus resale, feed-in tariff, export price.
- Return on investment, installation cost.
- Any change to the Consumption page, its toggle or its by-usage € figures.
- A week period on this page.
- Backfilling the arbiter gain before deployment.
- Fixing bad historical meter data (the reference installation has 3 074 kWh booked on a washing machine in March 2026): reported separately.

## Functional Requirements

### FR1 — Navigation

- Route `/energy/bilan`. The Energy menu (sidebar and the phone's Energy menu) lists: En direct, Bilan, Consommation, Production. `/energy` still redirects to `/energy/live`.
- The entry shows whenever the Energy section shows (a main meter exists).
- The page uses the shared Energy period and date (`useEnergy`), so switching from Consommation keeps the day, month or year being read. The selector offers Jour, Mois, Année only; arriving with the week period selected switches the store to the month containing the date.

### FR2 — Bill headline

- The period's grid bill in € (`text-value`), with the peak and off-peak parts. It is the same figure as the Consumption page's € total for the same period (`totals.cost_*` of `/energy/history`).
- Label by period: "Facture du jour" (with ", en cours" for today), "Facture de <mois>" (", au <jour>" for the current month), "Facture <année>" (", au <date>" for the current year).

### FR3 — Comparison

- **Day**: the average daily bill of the 7 days before the date, among those with consumption. "7 jours précédents : X € par jour en moyenne." Hidden if none of the 7 has data.
- **Month**: for the current month, from two complete days of data on (the 3rd), the projection `bill × month length / time covered by the bill` (the daily bucket holds no hours of today) ("Au même rythme, <mois> coûtera environ X €"). For any month, the bill of the same month a year earlier when it has data ("<Mois> <année-1> : X €").
- **Year**: the comparable months are the months fully elapsed in the selected year that have consumption on every day but two at most, in both years (a meter installed on April 28 does not make April comparable). The dashed tick of FR6 follows the same rule. "De <premier> à <dernier> : X €, contre Y € en <année-1> (±N %)." Hidden when there is no comparable month. When the comparable months are not contiguous, the sentence names their count instead of a range.

### FR4 — Solar value

Shown only when a production meter exists.

- **Avoided by solar** = for each chart point, self-consumed Wh × the point's own blended price (`point cost / point consumption`). Summed over the period. Since `/energy/history` points price the whole consumption, `bill + avoided` is exactly the sum of the points' costs.
- A bar "Électricité consommée, en euros" split into "Payé au fournisseur" and "Évité grâce au solaire", and the sentence "Sans panneaux, la facture aurait été de X €."
- Tile "Économie solaire": the avoided € and the self-consumed kWh.

### FR5 — Arbiter gain

- A new core component, the **arbiter gain meter**, samples the arbiter's public state every 60 s. When the arbiter is enabled and the meter is fresh (`availableSurplusW` not null), it takes the loads in state `granted` with their effective watts `w_i` (live draw when fresh), their sum `D`, and the grid import `I = max(0, −availableSurplusW)`. The solar power used by them is `S = max(0, D − I)`: the managed loads are served last by the sun, as for EV sessions (spec 191). Each load gets `S × w_i / D`.
- The energy is that power over the elapsed time (capped at 120 s, so a stalled process never books a long gap). It is split HP/HC by the `TariffClassifier` at that moment and priced with the current tariff, so the € is frozen.
- Per local day and per equipment, the solar Wh and the € accumulate in memory, are flushed to SQLite every 15 minutes in one transaction, and on shutdown. A read adds the not yet flushed part.
- The first day the meter ran with the arbiter enabled is stored once (`energy.arbiterGain.since`).
- Tile "Gain de l'arbitre": the period's € and the two loads that contributed most ("Borne 5,4 kWh, chauffe-eau 2,2 kWh"). When the period ends before `since`: "pas encore mesuré". When it starts before: the value plus "mesuré depuis le <date>". The tile is hidden when the arbiter is disabled and the period has no gain. A load without its own meter counts at its learned or declared watts while granted (documented limit).
- The gain is part of the solar value (FR4), not added to it.

### FR6 — Cost chart

- Stacked bars per hour (day), per day (month), per month (year): paid peak, paid off-peak, avoided by solar on top. Paid parts of a point are its HP and HC costs times `1 − self-consumed share` (share = self-consumed Wh / consumption Wh of the point), which sums to the bill.
- Year view: a dashed tick per month at the previous year's bill for that month, when it has data. Legend "Facture <année-1>, même mois".
- Tooltip per bar: paid, avoided, and the previous year's bill in the year view, as neutral text beside colour swatches (`TooltipSeriesRow`).
- Energy palette tokens only: `--energy-hp`, `--energy-hc`, `--solar-auto`; the avoided figures in text take `--solar-ink`.

### FR7 — By usage

- One row per sub-meter of the partition (spec 091/173, separate supplies excluded as in spec 179) plus "Autres": kWh, paid €, avoided €, a bar paid / avoided, sorted by paid €.
- Each point's Wh of a meter is priced with that point's blended price and split by that point's self-consumed share. The figures therefore differ slightly from the Consumption page's by-usage €, which applies one blended rate to the whole period (spec 123); this page is the more precise of the two.
- Without a production meter the avoided column and bar part are absent.

### FR8 — Method

A last card, folded on the phone, says how the figures are made: the HP and HC prices with a link to the tariff settings; paid = grid kWh at the price of the time; avoided = self-consumed solar kWh at the price they would have cost; the by-usage split is per hour, per day or per month according to the view.

### FR9 — API

`GET /api/v1/energy/bilan?period=day|month|year&date=YYYY-MM-DD` returns everything the page shows (see architecture). 400 on another period, 404 without a main meter, 503 without InfluxDB, like `/energy/history`.

## Acceptance Criteria

- [x] AC1 — The Energy menu reads En direct, Bilan, Consommation, Production on desktop and phone; Energy opens on En direct.
- [x] AC2 — For a given period the bill equals the Consumption page's € total for the same period.
- [x] AC3 — `bill + avoided` equals the sum of the `/energy/history` points' costs for the period (to the cent).
- [x] AC4 — The chart's paid parts sum to the bill; its avoided parts sum to the avoided total.
- [x] AC5 — The by-usage paid € sum to the bill when the sub-meters plus "Autres" cover the main meter (to rounding).
- [x] AC6 — Day comparison averages the bills of the 7 previous days that have consumption; hidden when none has.
- [x] AC7 — Month projection appears for the current month from day 3 on; the previous year's month appears only when it has data.
- [x] AC8 — Year comparison counts only months fully elapsed and covered by data (2 missing days at most) in both years.
- [x] AC9 — The arbiter gain meter books solar to granted loads as `max(0, D − I)` split pro rata of their watts, and nothing when the arbiter is disabled, its meter is stale, or no load is `granted`.
- [x] AC10 — Gain rows survive a restart (flush on shutdown and every 15 min) and a read includes the unflushed part.
- [x] AC11 — The arbiter tile reads "pas encore mesuré" for a period ending before `since`, and "mesuré depuis le …" for one straddling it.
- [x] AC12 — Without a production meter, no solar tile, no avoided bar part, no avoided column; without a tariff, the page shows the empty state linking to the tariff settings.
- [x] AC13 — The page matches the mockup's layout on desktop and phone, in light and dark, with the design-system tokens (no raw hex in energy components, no middle dot).
- [x] AC14 — The gain table is in the backup and survives a restore.

## Edge Cases

- No tariff configured (`tariffConfigured` false): empty state "Renseignez votre tarif pour voir le bilan", link to Settings, Tariff.
- No production meter: bill, comparison, chart (paid only) and by-usage (paid only); no solar tile.
- No sub-meter: the by-usage card is hidden.
- A point with no consumption: share 0, price 0, nothing paid or avoided.
- Self-consumption above the point's consumption (meter skew): share clamped to 1.
- A future date: the selector cannot go there (shared `canGoForward`).
- DST days (23 or 25 hours): the day has 23 or 25 bars (`expectedBucketTimes`).
- Arbiter granted-idle (granted, not drawing): not counted. A deleted equipment keeps its rows; the tile names it "Équipement supprimé".
- A restart between flushes loses at most 15 minutes of gain; a crash too. Accepted.
- Tariff prices changed: the gain keeps the price of the moment; bill and avoided use today's prices, as the Consumption page does (spec 123).

## Docs Delta

| Page (EN and FR)                             | Change                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `docs/user/energy.md` + `.fr.md`             | "Using the Energy section" lists the four pages; new "Bilan view" section; arbitration section mentions the gain |
| `docs/technical/api-reference.md` + `.fr.md` | `GET /api/v1/energy/bilan`                                                                                       |
| `docs/technical/architecture.md` + `.fr.md`  | "Arbiter gain meter (spec 200)" under the arbiter section                                                        |
| `docs/technical/data-model.md`               | Table `arbiter_daily_gain`                                                                                       |

Screenshots: none in this PR. Documentation screenshots are never taken on the production instance (family names, home topology); the Costs view gets its EN/FR captures from a demo instance in a follow-up.
