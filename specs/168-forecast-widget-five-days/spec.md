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

- The tile gains a five-day strip at its foot: day initial, max temperature,
  and a colour bar carrying that day's confidence.
- The tile becomes clickable on desktop and mobile, opening the existing detail
  sheet.
- The sheet gains a `weather_forecast` branch: one row per day, vertical, no
  horizontal scrolling, with the confidence pill on the right.
- The source line ("médiane de N modèles") moves into the sheet, where there is
  room for it.

**Out:**

- No change to the plugin, to what it publishes, or to how confidence is
  computed.
- No change to the equipment-page panel (`WeatherForecastPanel`), which keeps
  its horizontal cards.
- No new desktop drawer chrome. The detail sheet is bottom-anchored on desktop
  today, which is what the weather station already does; changing that is a
  separate decision about every widget, not about this one.

## Acceptance criteria

- [x] The tile renders a strip of up to five days below the J+1 summary.
- [x] Each strip column carries the day's confidence as a bar colour, using the
      same three semantic colours as the pill (success / warning / error).
- [x] A day whose confidence is unknown renders the bar in the neutral border
      colour, not in a confidence colour.
- [x] Clicking the tile opens the detail sheet, on desktop and on mobile.
- [x] The sheet lists every available day as a row: name, condition icon,
      max/min, rain, wind, confidence pill.
- [x] A day with no confidence renders its row without a pill, not with an
      empty or grey one.
- [x] The sheet shows the source line when the plugin publishes the model used.
- [x] Nothing changes for a household whose plugin predates 2.0: no strip
      colours beyond neutral, no pills, and the tile still opens the sheet.

## Edge cases

| Case                                   | Expected                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| No forecast bindings at all            | Tile renders nothing (unchanged), so no click target                                                                  |
| Only J+1 bound                         | No strip at all: a single column would repeat the headline the tile already shows full size. The sheet shows one row. |
| `confidence` absent (plugin < 2.0)     | Neutral bar, no pill, everything else renders                                                                         |
| `tempMax` null on a day                | Column shows an em dash instead of a number                                                                           |
| Days bound out of order (j3 before j1) | Ordered by `dayIndex`, as `parseForecastDays` already guarantees                                                      |
| More than five days published          | Strip caps at five; the sheet lists all of them                                                                       |
