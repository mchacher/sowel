# Spec 168 — Five days and their confidence, on the dashboard

## Problem

The dashboard forecast tile shows **one day** (J+1) and nothing else. The
household has a five-day forecast and a per-day confidence, published by the
plugin since 2.0 (spec 159) and rendered on the equipment page, but the
dashboard is where people actually look, and there it stops at tomorrow.

Two consequences, both observed on the reference installation:

- The confidence is invisible where the forecast is read. A day at ±2.1 °C of
  model spread and a day at ±5.0 °C are shown identically.
- Nothing suggests there is more behind the tile, so nobody clicks. The detail
  sheet already exists and is wired for every widget, but `EquipmentWidget`
  only forwards `onOpenDetail` to the weather **station**, never to the
  forecast.

## Scope

**In:**

- The tile qualifies the one day it shows: a coloured dot and the word, on the
  condition line (option A2). It carries no strip of the other days.
- The tile becomes clickable on desktop and mobile, opening the existing detail
  sheet.
- The sheet gains a `weather_forecast` branch (option C2): the card anatomy of
  the equipment page, narrowed so the five days fit across a 390px sheet with
  no horizontal scrolling. Day, condition, maximum, minimum, wind, and the
  confidence as a coloured rule with the word where there is room for it.
- Rain is not repeated in the sheet: a 68px column has room for one metric, the
  tile already carries rain for tomorrow, and wind is the one that changes what
  you do with a shutter or an awning.
- The source line ("médiane de N modèles") moves into the sheet, where there is
  room for it.

Two options were drawn and rejected during review with the maintainer: A3, a
five-day strip on the tile, and B2, one vertical row per day in the sheet. A3
duplicated on the tile what the sheet now shows properly; B2 could not hold a
day, its metrics and its verdict on one 390px line without the row wrapping
ragged.

**Out:**

- No change to the plugin, to what it publishes, or to how confidence is
  computed.
- No change to the equipment-page panel (`WeatherForecastPanel`), which keeps
  its horizontal cards.
- No new desktop drawer chrome. The detail sheet is bottom-anchored on desktop
  today, which is what the weather station already does; changing that is a
  separate decision about every widget, not about this one.

## Acceptance criteria

- [x] The tile names tomorrow's confidence, with a dot in the matching semantic
      colour (success / warning / error) and the word beside it.
- [x] The tile shows nothing at all when tomorrow has no published confidence:
      no dot, no word.
- [x] Clicking the tile opens the detail sheet, on desktop and on mobile.
- [x] The sheet renders every available day as a column that fits without a
      horizontal scroll at 390px: name, condition icon, max, min, wind.
- [x] Each column carries a confidence rule in the same three colours; a day
      with no confidence keeps the neutral rule and gets no word.
- [x] The five rules land on one baseline whatever each day published.
- [x] The sheet shows the source line when the plugin publishes the model used.
- [x] Nothing changes for a household whose plugin predates 2.0: no dot on the
      tile, neutral rules in the sheet, and the tile still opens the sheet.

## Edge cases

| Case                                   | Expected                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| No forecast bindings at all            | Tile renders nothing (unchanged), so no click target                                          |
| Only J+1 bound                         | Tile unchanged; the sheet shows one column                                                    |
| `confidence` absent (plugin < 2.0)     | No dot on the tile, neutral rule in the sheet, everything else renders                        |
| `tempMax` null on a day                | Column shows a dash instead of a number                                                       |
| `tempMax` published as NaN             | Rejected by the parser (`Number.isFinite`), so the column shows the dash, not the literal NaN |
| Days bound out of order (j3 before j1) | Ordered by `dayIndex`, as `parseForecastDays` already guarantees                              |
| More than five days published          | Every published day gets a column; they narrow together                                       |
