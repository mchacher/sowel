# Spec 145 — Series colours and Y axes on the Analyse chart

## Context

Three things about an Analyse chart cannot be controlled today, and they all
hurt the same use case: reading several equipments together over a long
session.

**Colours are assigned by insertion order.** `SERIES_COLORS` in
`AnalyseView.tsx` is an eight-entry palette indexed by the position of the
series in the list — the first series is always ocean blue, the second always
amber. The user has no say. Two consequences:

- A chart that compares "outdoor" against "indoor" cannot use blue for the
  cold one and amber for the warm one unless the series happen to be added in
  that order.
- Removing a series in the middle re-indexes every series after it, so a saved
  chart reopened after an edit comes back in different colours. Nothing about
  the colour is persisted — `SavedChartSeriesConfig` carries only
  `equipmentId` and `alias`.

**The measurement axis always starts at zero.** The left `YAxis` of the
measurements chart declares no `domain`, so Recharts applies its default
`[0, 'auto']`. For a power curve that is exactly right. For a tank temperature
that lives between 48 °C and 55 °C it is not: the whole story is squeezed into
the top eighth of the plot and a 7 °C drop reads as a flat line. The user wants
the axis fitted to the data — but not always, and not silently: the zero-based
axis stays the default, because that is how every existing chart reads today.

**Every measurement shares one scale.** A temperature and a humidity plotted
together are read off the same axis, so the 21 °C curve is squashed flat under
the 60 % one. Comparing a room's temperature with its humidity — the reason to
put them on one chart at all — is exactly what the shared scale prevents.

## What ships

### F1 — Per-series colour

- The colour dot on each series pill becomes a button. Clicking it opens a
  popover with the eight palette colours plus a native colour input for a free
  hue.
- The same picker opens from the chart legend: clicking a legend entry opens it
  at the click point. The legend is where the eye already is when reading the
  chart, and on a chart with many series it is closer than the pill row.
- The chosen colour applies immediately to the line/bar, the envelope band, the
  active dot, the legend marker and the pill dot.
- The colour is part of the chart configuration: it is written by _Save_ /
  _Save as_ and restored when the chart is reopened.
- Charts saved before this spec have no colour: they fall back to the palette
  by position, i.e. they render exactly as they do today.

### F2 — Fitted Y axis (opt-in)

- A toggle in the chart action row (next to the envelope toggle) switches the
  measurement axis between:
  - **off (default)** — current behaviour, Recharts' zero-anchored axis;
  - **on** — domain = [min, max] of the plotted values, padded by 8 % on each
    side, with round tick values picked inside that domain.
- The padding is what keeps the curve off the frame: at 8 % neither the peak
  touches the top of the plot area nor the trough its bottom.
- A series that never goes negative never gets a negative axis: the lower
  padding is clamped at zero. A 0–3000 W curve therefore looks the same fitted
  or not, which is the intent — fitting only changes charts that need it.
- The toggle state is part of the chart configuration, saved and restored like
  the colours.
- The toggle is hidden when it would mean nothing: on a cumulative (bar) chart,
  where bars must be read from zero, and on a states-only chart, whose axis is
  the fixed `[0, 1]` scale.
- With two measurement axes (F3), each is fitted to its own series.

### F3 — One axis per quantity, up to two

- When the chart plots **exactly two** quantities, they get an axis each: the
  first on the left, the second on the right. Each scale is then free to span
  only its own data.
- Quantities are grouped **by unit**, not by category: two temperatures, or a
  humidity and a battery (both `%`), keep sharing one axis. Splitting
  same-unit series would suggest they are on different scales when they are
  directly comparable.
- With one, three or more quantities, everything stays on the shared left axis
  as today — three scales do not fit on two sides.
- When two axes are shown, the tick labels carry their unit (`21.5 °C` on the
  left, `60 %` on the right). With one axis they stay bare numbers, as today:
  the legend and the tooltip already give the unit.
- A split axis is tinted with the colour of its curve, so the eye pairs a
  series with its scale without a detour through the legend. Only when the
  axis carries a single series — several curves on one axis have no single
  colour to borrow, and a shared axis (one, or three-plus quantities) stays
  neutral, as today.
- State series are unaffected: they keep their own `[0, 1]` axis on the right,
  stacked outside the second measurement axis when both are present.

## Scope

**In scope** — the Analyse page (`AnalyseView.tsx`) and the chart
configuration that backs it.

**Out of scope**

- The equipment history chart (`TimeSeriesChart`) and the Energy page charts.
  They plot a single series or a fixed set of business-coloured ones; neither
  request applies. Explicitly excluded by the user.
- The state axis (`[0, 1]`) and the bar chart axis. Both keep their current
  domains under every setting — a cumulative chart plotting rain (mm) and
  energy (kWh) together keeps its single shared axis.
- Manual axis assignment per series, log scale, manual min/max entry, and a
  third measurement axis. The margin ratio is a constant, not a setting.

## Acceptance criteria

| #   | Given                                               | When                                                       | Then                                                                                  |
| --- | --------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | A chart with three series                           | The user clicks the dot of the second pill and picks green | Only that series turns green — in the pill, the line, the legend and the band         |
| 2   | Same chart                                          | The user picks a free hue in the colour input              | The series takes that hue live, without a data refetch                                |
| 3   | A chart with custom colours                         | Save, reload the page, reopen the chart                    | The custom colours come back                                                          |
| 4   | A chart saved before spec 145                       | It is reopened                                             | Colours are the palette in insertion order, as before                                 |
| 5   | A temperature chart ranging 48–55 °C                | The fit toggle is turned on                                | The axis reads roughly 47.5–55.5 with round ticks, and the curve touches neither edge |
| 6   | A power chart ranging 0–3000 W                      | The fit toggle is turned on                                | The axis still starts at zero (lower clamp)                                           |
| 7   | A chart with the fit on                             | Save, reopen                                               | The fit is still on                                                                   |
| 8   | A cumulative (rain / energy) chart                  | Any state                                                  | No fit toggle is offered, bars keep their zero baseline                               |
| 9   | A states-only chart                                 | Any state                                                  | No fit toggle is offered, the axis stays `[0, 1]`                                     |
| 10  | A mixed measurements + states chart with the fit on | —                                                          | Only the measurement axes are fitted; the right `[0, 1]` axis is untouched            |
| 11  | Same chart                                          | The user clicks a legend entry                             | The picker opens at the click point and recolours that series                         |
| 12  | A temperature + humidity chart                      | —                                                          | Two axes: °C on the left, % on the right, each spanning only its own data             |
| 12b | Same chart, one series per quantity                 | —                                                          | The °C axis is tinted like its curve, the % axis like its own                         |
| 12c | Two temperatures + one humidity                     | —                                                          | The right (%) axis is tinted; the left axis carries two curves so it stays neutral    |
| 13  | A chart with two temperatures                       | —                                                          | One shared axis — same unit, directly comparable                                      |
| 14  | A temperature + humidity + pressure chart           | —                                                          | One shared left axis, as before                                                       |
| 15  | A temperature + humidity + relay chart              | —                                                          | °C left, % right, and the `[0, 1]` state axis stacked outside it                      |

## Edge cases

- **Flat series** (every point identical, e.g. a sensor stuck at 20.5 °C).
  There is no span to take a percentage of. The axis opens a window of
  ±max(8 % of the value, 1) around it so the line sits mid-plot instead of on
  an edge. A flat zero series yields `[0, 1]`.
- **Envelope band on.** The band can reach beyond the mean line, so the fit
  takes the `min` / `max` keys into account whenever the band is actually
  rendered. Turning the envelope off re-fits to the mean line alone.
- **No data in the window.** The fit returns nothing and the axis falls back to
  the default, so an empty chart is never given an invented domain.
- **Series removed while fitted.** The domain recomputes from what is left. If
  the removal drops the chart from two quantities to one, the right axis
  disappears and everything returns to the left one — and the reverse when a
  series is added.
- **Category with no declared unit** (an unclassified binding). It counts as
  one "unitless" quantity, so a temperature plus an unclassified series does
  split into two axes. That is the right call: nothing says they share a scale.
- **Colour on a state series.** Allowed — it colours the step line on the right
  axis. Nothing about the axis changes.
- **Unreadable colour.** The free input can produce a hue that vanishes against
  the background in one of the two themes. Accepted: the palette is one click
  away, and constraining the input was explicitly declined.
- **Viewer / standard user.** Colours and the fit toggle stay usable — like
  adding a series, they are local until saved, and only admins see the save
  controls.
