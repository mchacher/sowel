# Implementation Plan — Spec 205

Branch `feat/bilan-fixed-fee`, one pull request.

## Tasks

- [ ] 1 — Mockup of the bill card, the markers and the method card (desktop and phone)
- [ ] 2 — Types, backend and UI
- [ ] 3 — `priceSpans`, `periodFee` in `pricing.ts`
- [ ] 4 — Route and `computeBilan` pass-through
- [ ] 5 — UI: fee block, markers, method card, strings EN and FR
- [ ] 6 — Docs delta, EN and FR
- [ ] 7 — Checked on a scratch or shadow instance with the 9 kVA prices: a month crossed by 1 August 2025, the
      year 2025; 1280 px and 390 px, light and dark

## Test Plan

### Modules to test

`pricing` (`priceSpans`, `periodFee`), `bilan` (`computeBilan` pass-through), `api/routes/energy` (bilan),
`bilan-format` (`feeLines`, `methodSpans`), `BilanPage` (fee block shown or not).

### Scenarios

| Module        | Scenario                                                            | Expected                                  |
| ------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| periodFee     | July 2026, one version 240 €/year                                   | 31 × 240 / 365, days 31, without 0        |
| periodFee     | Change on 16 July from 240 to 300 €/year                            | 15 × 240/365 + 16 × 300/365               |
| periodFee     | February 2028 (leap), 366-day rate                                  | 29 × fee / 366                            |
| periodFee     | Version without fee for the first 10 days, then 240                 | 21 days counted, daysWithoutFee 10        |
| periodFee     | No version has a fee                                                | null                                      |
| periodFee     | Year across the DST changes                                         | 365 days counted                          |
| priceSpans    | Period inside one version                                           | one span = the period                     |
| priceSpans    | Period crossed by two changes                                       | three spans, clamped, contiguous          |
| priceSpans    | Period before the first dated version                               | the dateless version, clamped             |
| routes/energy | Current month on the 11th                                           | `fee.days` = 11                           |
| routes/energy | Day view                                                            | `fee` null, `priceSpans` one entry        |
| routes/energy | Future month                                                        | `fee` null                                |
| computeBilan  | Headline, comparison, points unchanged with a fee                   | identical to the response without it      |
| bilan-format  | `feeLines` with and without days without fee, with and without kVA  | the four captions                         |
| bilan-format  | `methodSpans` one span / two spans, FR and EN                       | the sentences                             |
| BilanPage     | `fee` null                                                          | no fee block, no total                    |

The core scenario (change on 16 July) is seen failing once with a single daily rate.
