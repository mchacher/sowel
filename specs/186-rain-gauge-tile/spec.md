# Spec 186 — Rain gauge tile

Mockup (validated 2026-10-08): [`maquette.html`](maquette.html).

## Problem

The dashboard tile of a `weather` equipment renders temperatures only
(`WeatherStationWidget`, mobile `useMobileState`). An equipment that only
measures rain — a tipping-bucket gauge such as `sowel-plugin-rain-gauge` —
has no temperature binding, so the tile shows `— °C` although rain data is live.

Clicking it opens the generic weather sheet, which lists `Pluie 1h` /
`Pluie 24h` only: no weekly or monthly total, no "when did it last rain".

## Scope

A **rain-only weather equipment** is a `weather` equipment with at least one
`rain`-category binding or computed `rain_24h`, and no binding in any other
category the generic weather sheet lists (temperature, but also wind, humidity,
pressure, noise, CO2…; the battery does not count). The rain tile and sheet
replace the generic ones, so a station with rain and wind keeps the generic
sheet rather than losing its wind rows.

For those equipments only:

1. **Tile (desktop + mobile)** — headline is today's rain (`rain_today`
   binding). Second line: rolling 24 h total (`sum_rain_24`, else computed
   `rain_24h`), with a pulsing dot when it rained during the last hour
   (`sum_rain_1` / `rain_1h` > 0). Without a `rain_today` binding (e.g. a
   Netatmo rain module) the headline is the 24 h total, captioned "24 h".
2. **Detail sheet** (opened by a click on the tile):
   - today, rolling 24 h, last 7 days, last 30 days;
   - "measured over N days only" under 7 d / 30 d when the history starts
     inside the window;
   - **last rain**: the most recent day with rain > 0, looked up over the
     **last 6 months** (183 days), with that day's total. Today counts. Shown
     as "Aujourd'hui", "Hier", or "sam. 22 août · il y a 47 j". None found →
     "Aucune depuis 6 mois" when the history covers the window, otherwise
     "Aucune depuis le <first measured day>" — never claim more than the data;
   - a 30-bar histogram of daily totals (tap / hover → day + value);
   - battery level.

Totals come from the existing history API
(`GET /history/:equipmentId/:alias?aggregation=1d`) on the `rain` binding,
one request of daily points per sheet opening (183 days, plus one so the oldest
day comes back whole). Days are cut in the home time zone
(`GET /system/timezone`, already loaded by the app shell), like the server cuts
them, not in the viewer's.

The hourly history only writes an hour once it has ended, so it lags behind the
live `rain_today`. When the plugin publishes it, that live value takes today's
slot before the 7 d / 30 d sums, the bars and the last rain are computed: every
figure of the sheet agrees with "Aujourd'hui". It only counts if it was
published on the house's today (a stopped plugin leaves yesterday's total in
the binding), and it never lowers today below what the history already holds.

**Retention.** The API sums rain from the hourly bucket, kept 90 days. Until
the follow-up backend change lands (phase 2, #1027: a dedicated
`sowel-rain-hourly` bucket keeping the hourly rain points for one year), the
sheet sees at most 90 days back and says so ("Aucune depuis le …").

## Out of scope

- Weather stations that also carry temperatures: tile and sheet unchanged.
- Rain alerts, plugin changes.
- Backend retention change: phase 2, #1027 (stacked on #1024).

## Edge cases

| Case                                                                      | Behaviour                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Request fails (HTTP / network)                                            | 7 d, 30 d, last rain `—`, no bars, "Historique indisponible"                                                                                |
| No history point at all (also InfluxDB down: the route answers `200 []`)  | 7 d, 30 d, last rain `—`, empty bars; with a live `rain_today` published today, today alone counts as measured ("mesuré sur 1 j seulement") |
| History shorter than 6 months                                             | "Aucune depuis le <first day>" instead of "Aucune depuis 6 mois"                                                                            |
| History started 2 days ago                                                | Totals over the days measured, "mesuré sur 2 j seulement"                                                                                   |
| Days before the first point                                               | Empty bars (dashed), not zero                                                                                                               |
| Day with no point after the first one                                     | Counted as 0 mm                                                                                                                             |
| Daily buckets stamped at UTC midnight (before PR #1024) vs local midnight | Both map to the right local day                                                                                                             |
| No `rain` binding to query                                                | Live values only, history rows `—`, no error line                                                                                           |
| Rain in the 00:00–01:00 local hour, before PR #1024 (UTC day buckets)     | Previous day in summer only: hours are stamped at their end                                                                                 |
| Rain in the current hour (not in the hourly history yet)                  | Live `rain_today` takes today's slot; every figure agrees                                                                                   |
| `rain_today` last published before today, negative, or below the history  | Ignored for the summary: the history's today stands                                                                                         |
| Viewer in another time zone than the home                                 | Days cut in the home zone (the viewer's until it has loaded)                                                                                |

## Acceptance criteria

- [x] A rain-only weather tile shows today's rain and the 24 h total instead of `— °C`, on desktop and mobile.
- [x] A station with temperatures renders exactly as before.
- [x] The detail sheet shows today, 24 h, 7 d, 30 d, last rain (6 months) and a 30-day histogram.
- [x] Partial history is flagged; a failed history request never blanks the live values.
