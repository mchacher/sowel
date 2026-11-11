# Implementation Plan — Spec 204

Branch `feat/seasonal-offpeak`, one pull request.

## Tasks

- [x] 1 — Types: `TariffSeason`, `TariffConfig.summer` (backend and UI)
- [x] 2 — `schedulesOn`, `isSummer` in `tariff-classifier.ts`; `classify` through them
- [x] 3 — Recipe snapshot and `defaultContract` through them
- [x] 4 — Route: schema, defaults, `from > to`, GET
- [x] 5 — UI: checkbox, two blocks, « En cours », strings EN and FR (validated mockup of spec 202)
- [x] 6 — Docs delta, EN and FR
- [ ] 7 — Screenshots at 1280 px and 390 px, light and dark, on a scratch instance

## Test Plan

### Modules to test

`tariff-classifier`, `recipe-manager` (tariff snapshot), `pricing` (`defaultContract`), `api/routes/energy`
(tariff routes), `ui/src/lib/tariff`, `TariffSettings` (save body).

### Scenarios

| Module            | Scenario                                                 | Expected                                     |
| ----------------- | -------------------------------------------------------- | -------------------------------------------- |
| tariff-classifier | No `summer`, any date                                    | same split as before (existing tests intact) |
| tariff-classifier | `summer` set, window on 15 July 13:00, summer HC 12–15   | all HC                                       |
| tariff-classifier | Same config, window on 15 January 13:00, winter HP 6–22  | all HP                                       |
| tariff-classifier | 31 March 13:00 / 1 April 13:00                           | winter / summer                              |
| tariff-classifier | 31 October 13:00 / 1 November 13:00                      | summer / winter                              |
| tariff-classifier | Window 31 October 23:30, 30 min                          | summer schedule for the whole window         |
| tariff-classifier | Summer with no schedule for the day                      | all HP                                       |
| tariff-classifier | Cache: config changed from single to seasonal            | the new config is used                       |
| isSummer          | `from`/`to` custom (05-15..09-15), boundaries            | inclusive at both ends                       |
| recipe-manager    | Snapshot in July with a summer schedule                  | `offPeakToday` = summer HC slots             |
| pricing           | `defaultContract`, HC only in summer                     | `hphc`                                       |
| routes/energy     | PUT with `summer` without from/to, then GET              | stored and returned with 04-01 / 10-31       |
| routes/energy     | PUT with `summer.from` "13-01" / "04-31" pattern-invalid | 400                                          |
| routes/energy     | PUT with `from` after `to`                               | 400, nothing stored                          |
| routes/energy     | PUT without `summer` after a seasonal one                | single schedule stored                       |
| ui lib/tariff     | `isSummerOn` on boundaries; label of each season         | inclusive; dates from the stored season      |
| TariffSettings    | Ticked: save body has `summer`; unticked: it does not    | as stated                                    |
| TariffSettings    | Ticking first time copies the current slots into summer  | summer block shows the same slots            |

The core scenario (15 July vs 15 January) is seen failing once with `classify` reading `config.schedules`.
