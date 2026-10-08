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

A **rain-only weather equipment** is a `weather` equipment with no
`temperature` / `temperature_outdoor` binding and at least one `rain`-category
binding or computed `rain_24h`.

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
one request of 183 daily points per sheet opening.

**Retention.** The API sums rain from the hourly bucket, kept 90 days. Until
the follow-up backend change (daily rain totals kept one year, phase 2) lands,
the sheet sees at most 90 days back and says so ("Aucune depuis le …").

## Out of scope

- Weather stations that also carry temperatures: tile and sheet unchanged.
- Rain alerts, plugin changes.
- Backend retention change: phase 2, separate PR stacked on #1024.

## Edge cases

| Case                                                                      | Behaviour                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Request fails (HTTP / network)                                            | 7 d, 30 d, last rain `—`, no bars, "Historique indisponible"     |
| No history point at all (also InfluxDB down: the route answers `200 []`)  | 7 d, 30 d, last rain `—`, empty bars                             |
| History shorter than 6 months                                             | "Aucune depuis le <first day>" instead of "Aucune depuis 6 mois" |
| History started 2 days ago                                                | Totals over the days measured, "mesuré sur 2 j seulement"        |
| Days before the first point                                               | Empty bars (dashed), not zero                                    |
| Day with no point after the first one                                     | Counted as 0 mm                                                  |
| Daily buckets stamped at UTC midnight (before PR #1024) vs local midnight | Both map to the right local day                                  |
| No `rain` binding to query                                                | Live values only, history rows `—`, no error line                |
| Rain between 00:00 and 02:00 local before PR #1024                        | Counted on the previous day (UTC day buckets); fixed by #1024    |

## Acceptance criteria

- [x] A rain-only weather tile shows today's rain and the 24 h total instead of `— °C`, on desktop and mobile.
- [x] A station with temperatures renders exactly as before.
- [x] The detail sheet shows today, 24 h, 7 d, 30 d, last rain (6 months) and a 30-day histogram.
- [x] Partial history is flagged; a failed history request never blanks the live values.
