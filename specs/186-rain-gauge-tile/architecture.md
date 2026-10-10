# Spec 186 — Architecture

UI only. No type, migration, event, route or WebSocket change.

## Data flow

```
equipment.dataBindings / computedData ──► readRainLive()      ──► tile (desktop, mobile)
                                                              └─► sheet: today / 24 h
GET /history/:eq/:rainAlias?aggregation=1d&from=now-184d
  + live rain_today, home time zone    ──► summarizeRainHistory() ──► sheet: 7 d / 30 d / last rain / bars
```

The history route sums `rain`-category values per day from the **hourly**
bucket (the daily bucket only stores means), and that bucket is kept 90 days
(`DEFAULT_RETENTION.hourly`). The UI therefore never claims "no rain" further
back than the first day it received (`RainSummary.since`). Phase 2 (#1027) adds a
dedicated `sowel-rain-hourly` bucket keeping the hourly rain points for one year
(a task copies the `category == "rain"` points from the hourly bucket), so the
6-month lookback is fully served. Days are still cut at local midnight at query
time: nothing time-zone dependent is stored.

An hour reaches the hourly bucket only once it has ended, so the history lags
behind the live `rain_today`. When that binding has a value, it replaces today's
slot before the sums, the bars and the last rain are computed.

## Day keying

Days are keyed in the **home** time zone, the one the server runs in (spec 061),
read from the `useTimezone` store (`GET /api/v1/system/timezone`, fetched by
`AppLayout`); the browser's zone stands in until it has loaded. A browser in
another zone would otherwise shift every bar by a day.

Daily points are bucket starts. Before PR #1024 they sit on **UTC** midnight,
after it on the home's **local** midnight (e.g. `22:00Z` for Paris in summer). A
point at exactly `00:00:00Z` is keyed by its UTC date, any other by its date in
the home zone (`Intl.DateTimeFormat` with `timeZone`). Both give the intended
calendar day. The request starts one day before the window, so the oldest day
comes back whole; the extra, partial bucket falls outside the window and is
dropped.

## Files

| File                                                | Change                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ui/src/components/equipments/rain-summary.ts`      | **new** — `isRainOnlyWeather`, `readRainLive`, `summarizeRainHistory`, `dayKey` |
| `ui/src/components/equipments/rain-summary.test.ts` | **new** — unit tests                                                            |
| `ui/src/components/dashboard/RainGauge.tsx`         | **new** — `RainTileBody`, `RainMobileHeadline`, `RainLine`, `RainDetailContent` |
| `ui/src/components/dashboard/EquipmentWidget.tsx`   | weather branch → rain tile when rain-only                                       |
| `ui/src/components/dashboard/MobileWidgetCard.tsx`  | weather branch → rain card when rain-only                                       |
| `ui/src/components/dashboard/WidgetDetailSheet.tsx` | weather branch → `RainDetailContent` when rain-only                             |
| `ui/src/i18n/locales/{fr,en}.json`                  | `weather.rain*` labels                                                          |
