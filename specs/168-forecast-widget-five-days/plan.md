# Plan — spec 168

## Steps

1. [x] Lift `CONFIDENCE_STYLES` into `weatherForecastUtils.ts`, add `CONFIDENCE_BAR`;
       point `WeatherForecastPanel` at the lifted copy.
2. [x] `ForecastStrip`: the shared strip, used by the desktop tile and the phone tile.
3. [x] `WeatherForecastWidget`: accept `onOpenDetail`, render the strip, clickable card.
4. [x] `MobileWidgetCard`: the same strip under the phone tile's state line.
5. [x] `EquipmentWidget`: forward `onOpenDetail` to the forecast widget.
6. [x] `mobile-click-action.ts`: `weather_forecast` opens the sheet.
7. [x] `ForecastDetailContent`: the vertical list.
8. [x] `WidgetDetailSheet`: the `weather_forecast` branch.
9. [x] Tests.
10. [x] Docs: the energy/weather user page if it describes the tile.

## Test Plan

### Modules to test

- `weatherForecastUtils` — the lifted colour maps (pure).
- `ForecastStrip` / `WeatherForecastWidget` — the strip (component test, existing tier).
- `MobileWidgetCard` — the strip on the phone tile.
- `EquipmentWidget` / `EquipmentDetailSheet` — the wiring that hands them to the user.
- `ForecastDetailContent` — the vertical list (component test).
- `getMobileClickAction` — the new type (pure).

### Scenarios

| Module                | Scenario                                           | Expected                                                    |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| weatherForecastUtils  | `CONFIDENCE_BAR` covers every `ForecastConfidence` | no member resolves to undefined                             |
| weatherForecastUtils  | one definition of the styles                       | `WeatherForecastPanel` imports it, does not redefine        |
| WeatherForecastWidget | five days bound                                    | strip renders five columns with their max temperatures      |
| WeatherForecastWidget | confidence per day                                 | bar colour follows the day's confidence, not a fixed colour |
| WeatherForecastWidget | confidence null (plugin < 2.0)                     | bar renders neutral, no crash                               |
| ForecastStrip         | only J+1 bound                                     | no strip, the tile is unchanged                             |
| MobileWidgetCard      | five days bound                                    | the phone tile carries the same strip                       |
| EquipmentWidget       | forecast + onOpenDetail                            | the tile is clickable and the handler fires                 |
| EquipmentDetailSheet  | forecast equipment                                 | the sheet renders the day list, not null                    |
| WeatherForecastWidget | more than five days                                | strip caps at five                                          |
| WeatherForecastWidget | `tempMax` null on a day                            | column shows a dash                                         |
| WeatherForecastWidget | `onOpenDetail` given                               | card is clickable and calls it                              |
| WeatherForecastWidget | `onOpenDetail` absent (edit mode)                  | card is not clickable                                       |
| ForecastDetailContent | five days                                          | five rows, in day order                                     |
| ForecastDetailContent | confidence present                                 | pill rendered with the day's wording                        |
| ForecastDetailContent | confidence null                                    | row renders, no pill                                        |
| ForecastDetailContent | model published                                    | source line rendered                                        |
| ForecastDetailContent | model absent                                       | no source line                                              |
| getMobileClickAction  | type `weather_forecast`                            | returns `onOpenDetail`                                      |
| getMobileClickAction  | unchanged types                                    | `sensor` and `weather` still return `onOpenDetail`          |
