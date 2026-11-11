# Implementation Plan — Spec 207

Branch `feat/issue-1232-bilan-kwh`, one pull request, closes #1232.

## Tasks

- [x] 1 — Mockup validated by the maintainer (2026-11-11)
- [ ] 2 — Types, backend and UI
- [ ] 3 — `gridWhOf`, kWh in the three comparisons, `energy` in `computeBilan`
- [ ] 4 — UI: kWh column, phone cards, solar tile, strings EN and FR
- [ ] 5 — Docs delta, EN and FR
- [ ] 6 — Checked on the shadow seeded from production: October 2026, November so far, a day, the year 2026;
      1280 px and 390 px, light and dark

## Test Plan

### Modules to test

`bilan` (`gridWhOf`, comparisons, `computeBilan`), `api/routes/energy` (bilan response), `bilan-format`,
`BilanPage`.

### Scenarios

| Module          | Scenario                                                        | Expected                                        |
| --------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| gridWhOf        | Point 1 000 Wh with 250 Wh self-consumed                        | 750 Wh                                          |
| gridWhOf        | Self-consumption above consumption (meter skew)                 | 0 Wh, never negative                            |
| dayComparison   | 7 days, 2 without data                                          | `averageGridWh` over the 5 days                 |
| monthComparison | Current month on day 11                                         | `projectedGridWh` at the bill's pace            |
| monthComparison | No previous-year data                                           | both previous-year fields null                  |
| yearComparison  | 5 comparable months                                             | `gridWh` / `previousYearGridWh` on those months |
| computeBilan    | Totals 446 / 260 kWh grid, 214 kWh self-consumed                | `energy` 446 000 / 260 000 / 920 000            |
| computeBilan    | Existing fields with `energy` added                             | identical to before                             |
| routes/energy   | Bilan month                                                     | `energy` present, equals history totals         |
| bilan-format    | Sentence with and without production; share rounding            | the two sentences, 23 %                         |
| bilan-format    | kWh comparison lines per kind, FR and EN; previous year missing | the lines; none when missing                    |
| bilan-format    | Average price with fee, without fee, without grid kWh           | two parts / one part / null                     |
| BilanPage       | Without production                                              | two-part bar, no solar wording                  |
| BilanPage       | Solar tile                                                      | « Sans panneaux… » sentence                     |

The core scenario (`gridWhOf` on a point with self-consumption) is seen failing once with `hp + hc` alone.
