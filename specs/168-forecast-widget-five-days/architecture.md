# Architecture — spec 168

## No data model change

Everything this feature renders is already in `dataBindings` and already parsed
by `parseForecastDays` (`ui/src/components/equipments/weatherForecastUtils.ts`),
which returns `ForecastDay[]` with `confidence: ForecastConfidence | null` and
`tempMaxSpread: number | null`.

No migration, no new event, no API change, no plugin change.

## Where the pieces already are

| Piece              | File                                                    | State                                                                                                                         |
| ------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Day parsing        | `weatherForecastUtils.ts`                               | exists, reused as is                                                                                                          |
| Confidence colours | `WeatherForecastPanel.tsx` (`CONFIDENCE_STYLES`)        | local const, **lifted** to the utils module so tile, sheet and panel share one definition                                     |
| Sheet chrome       | `BottomSheet.tsx`                                       | exists, reused                                                                                                                |
| Sheet dispatch     | `WidgetDetailSheet.tsx` (`EquipmentDetailSheet`)        | has no `weather_forecast` branch, **added**                                                                                   |
| Click plumbing     | `WidgetGrid.tsx` → `WidgetRenderer` → `EquipmentWidget` | `onOpenDetail` already reaches `EquipmentWidget` on desktop and mobile; it is simply **not forwarded** to the forecast widget |

## Desktop and mobile

`WidgetGrid`'s `!editMode` branch already renders `EquipmentDetailSheet` for
both viewports and already passes `onOpenDetail` to every widget. The desktop
path reaches the forecast tile through `EquipmentWidget`; the mobile path
reaches it through `MobileWidgetCard` + `getMobileClickAction`.

So the desktop work is one prop, and the mobile work is one line in the click
resolver, which currently opens the sheet for `sensor` and `weather` but not
for `weather_forecast`.

The sheet is bottom-anchored on both viewports. That is what the weather
station already does on desktop, so this feature inherits an existing
convention rather than inventing a second one.

## File changes

| File                              | Change                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `weatherForecastUtils.ts`         | export `CONFIDENCE_STYLES` and a `CONFIDENCE_BAR` map (bar colour per confidence, neutral fallback) |
| `WeatherForecastWidget.tsx`       | accept `onOpenDetail`, render the five-day strip, make the card clickable                           |
| `EquipmentWidget.tsx`             | forward `onOpenDetail` to `WeatherForecastWidget`                                                   |
| `mobile-click-action.ts`          | `weather_forecast` opens the detail sheet                                                           |
| `WidgetDetailSheet.tsx`           | `weather_forecast` branch → `ForecastDetailContent`                                                 |
| `ForecastDetailContent.tsx` (new) | the vertical day list                                                                               |
| `WeatherForecastPanel.tsx`        | import the lifted `CONFIDENCE_STYLES` instead of its local copy                                     |
| `fr.json` / `en.json`             | strip day initials come from `toLocaleDateString`, so no new string except the sheet's empty state  |

## Why the colours are lifted rather than copied

`CONFIDENCE_STYLES` currently lives inside `WeatherForecastPanel`. Copying it
into the tile and the sheet would give three definitions of what "assez fiable"
looks like, which is the shape of drift this repository has spent the week
removing. It moves to the utils module both already import.
