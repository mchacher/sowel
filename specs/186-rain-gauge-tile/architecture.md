# Spec 186 — Architecture

UI only. No type, migration, event, route or WebSocket change.

## Data flow

```
equipment.dataBindings / computedData ──► readRainLive()      ──► tile (desktop, mobile)
                                                              └─► sheet: today / 24 h
GET /history/:eq/:rainAlias?aggregation=1d&from=now-183d
                                       ──► summarizeRainHistory() ──► sheet: 7 d / 30 d / last rain / bars
```

The history route sums `rain`-category values per day from the **hourly**
bucket (the daily bucket only stores means), and that bucket is kept 90 days
(`DEFAULT_RETENTION.hourly`). The UI therefore never claims "no rain" further
back than the first day it received (`RainSummary.since`). Phase 2 keeps daily
rain totals for one year so the 6-month lookback is fully served.

## Day keying

Daily points are bucket starts. Before PR #1024 they sit on **UTC** midnight,
after it on **local** midnight (e.g. `22:00Z` for Paris in summer). A point at
exactly `00:00:00Z` is keyed by its UTC date, any other by its local date. Both
give the intended calendar day; for a UTC browser the two rules coincide.

## Files

| File                                                | Change                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ui/src/components/equipments/rain-summary.ts`      | **new** — `isRainOnlyWeather`, `readRainLive`, `summarizeRainHistory`, `dayKey` |
| `ui/src/components/equipments/rain-summary.test.ts` | **new** — unit tests                                                            |
| `ui/src/components/dashboard/RainGauge.tsx`         | **new** — `RainGaugeTileBody`, `RainDetailContent`                              |
| `ui/src/components/dashboard/EquipmentWidget.tsx`   | weather branch → rain tile when rain-only                                       |
| `ui/src/components/dashboard/MobileWidgetCard.tsx`  | weather branch → rain card when rain-only                                       |
| `ui/src/components/dashboard/WidgetDetailSheet.tsx` | weather branch → `RainDetailContent` when rain-only                             |
| `ui/src/i18n/locales/{fr,en}.json`                  | `weather.rain*` labels                                                          |
