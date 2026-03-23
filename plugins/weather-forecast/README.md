# Sowel Plugin: Weather Forecast

Weather forecast plugin for [Sowel](https://github.com/mchacher/sowel) using the [Open-Meteo](https://open-meteo.com/) API. Free, no API key required.

## Data Provided

Creates a single "Weather Forecast" device with 14 data points:

| Data                      | Type   | Unit | Description                                               |
| ------------------------- | ------ | ---- | --------------------------------------------------------- |
| condition                 | enum   | —    | sunny, partly_cloudy, cloudy, foggy, rainy, snowy, stormy |
| temperature               | number | °C   | Current temperature                                       |
| feels_like                | number | °C   | Apparent temperature                                      |
| humidity                  | number | %    | Relative humidity                                         |
| precipitation             | number | mm   | Current precipitation                                     |
| precipitation_probability | number | %    | Probability of rain today                                 |
| wind_speed                | number | km/h | Wind speed at 10m                                         |
| wind_gusts                | number | km/h | Wind gusts                                                |
| uv_index                  | number | —    | UV index (0-11+)                                          |
| cloud_cover               | number | %    | Cloud coverage                                            |
| solar_radiation           | number | W/m² | Direct solar radiation                                    |
| forecast_temp_min         | number | °C   | Today's minimum temperature                               |
| forecast_temp_max         | number | °C   | Today's maximum temperature                               |
| forecast_rain_today       | number | mm   | Today's total precipitation forecast                      |

## Installation

Install from the Sowel plugin store (Administration > Plugins).

## Configuration

- **Latitude/Longitude**: Automatically read from Sowel home settings (`Administration > Home`). No manual configuration needed.
- **Polling interval**: Configurable in plugin settings (default: 30 minutes, minimum: 15 minutes).

## Attribution

Weather data provided by [Open-Meteo](https://open-meteo.com/) — free weather API for non-commercial use.

## License

AGPL-3.0
