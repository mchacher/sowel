# Spec 186 — Plan

## Tasks

- [x] `rain-summary.ts`: detection, live values, history summary
- [x] Unit tests for `rain-summary.ts`
- [x] `RainGauge.tsx`: tile body + detail content (fetch on open)
- [x] Wire desktop tile, mobile card, detail sheet
- [x] i18n fr / en
- [x] Typecheck, tests, lint

## Test Plan

| Module       | Scenario                                                          | Expected                                        |
| ------------ | ----------------------------------------------------------------- | ----------------------------------------------- |
| rain-summary | Weather with temperature + rain                                   | `isRainOnlyWeather` false                       |
| rain-summary | Weather with rain bindings only                                   | true                                            |
| rain-summary | Weather with computed `rain_24h` only                             | true                                            |
| rain-summary | Non-weather equipment with rain                                   | false                                           |
| rain-summary | Rain plus wind / humidity / pressure / noise / CO2                | false (the generic sheet keeps those rows)      |
| rain-summary | Rain plus a category the weather sheet does not list              | true                                            |
| rain-summary | `readRainLive` with `sum_rain_24` and computed `rain_24h`         | binding wins                                    |
| rain-summary | `readRainLive` without `sum_rain_24`                              | falls back to computed                          |
| rain-summary | `readRainLive` history alias                                      | alias of the `rain` key binding, null if absent |
| rain-summary | `dayKey` on `00:00Z` stamp                                        | UTC date                                        |
| rain-summary | `dayKey` on local-midnight stamp                                  | local date                                      |
| rain-summary | 7 d / 30 d sums over a full window                                | sum of the last 7 / 30 days                     |
| rain-summary | History started 2 days ago                                        | measured 2, bars null before, sums over 2 days  |
| rain-summary | Gap after the first point                                         | 0, not null                                     |
| rain-summary | Rain today                                                        | last rain = today                               |
| rain-summary | Last rain 47 days ago (outside 30-day bars)                       | found, daysAgo 47, its mm                       |
| rain-summary | No rain at all over 6 months                                      | last rain null, `since` null                    |
| rain-summary | History shorter than the window (90 days)                         | last rain null, `since` = first day             |
| rain-summary | Window crossing a DST change                                      | whole days, correct `daysAgo`                   |
| rain-summary | No points                                                         | sums null, measured 0, all bars null, `empty`   |
| rain-summary | Points older than 183 days                                        | ignored                                         |
| rain-summary | Live `rain_today` above today's history value                     | replaces it in today, sums, bars, last rain     |
| rain-summary | Live `rain_today`, no history point for today yet                 | fills today; last rain = today                  |
| rain-summary | Live `rain_today` null                                            | history unchanged                               |
| rain-summary | `dayKey` / days in a pinned home zone (Paris, New York, Auckland) | home calendar day, whatever the runner's zone   |
| rain-summary | Home zone crossing a DST change                                   | whole days, correct keys and `daysAgo`          |
| rain-summary | Partial bucket at the request start                               | outside the window, dropped                     |
