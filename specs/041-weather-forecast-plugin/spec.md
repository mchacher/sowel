# Weather Forecast Plugin (Open-Meteo)

## Summary

A Sowel plugin that provides weather forecast data using the Open-Meteo API (free, no API key, no account required). Creates a single device with current conditions and daily forecast data. Uses the home's latitude/longitude from Sowel settings — zero configuration needed.

## Reference

- Plugin engine: specs/040-plugin-engine/
- Open-Meteo API: https://open-meteo.com/en/docs

## Acceptance Criteria

- [ ] Plugin installs from the Sowel plugin store
- [ ] Plugin starts automatically when lat/lon are available in Sowel settings
- [ ] 1 device "Weather Forecast" created with 14 data points
- [ ] Data updates every 30 minutes (configurable, min 15 min)
- [ ] New DataCategory values (weather_condition, uv, solar_radiation) added to Sowel core
- [ ] Device visible in Appareils page
- [ ] Equipment can be created and bound to the forecast device
- [ ] Data flows through the full pipeline: device → equipment → zone → WebSocket

## Scope

### In Scope

- Current weather conditions (temperature, humidity, wind, precipitation, UV, cloud cover, solar radiation)
- Daily forecast summary (temp min/max, rain total for today)
- Weather condition code mapping (WMO codes → human-readable enum)
- Configurable polling interval in minutes (default 30, minimum 15)
- Auto-detection of lat/lon from Sowel home settings

### Out of Scope

- Hourly forecast detail (deferred)
- Multi-day forecast (deferred)
- Weather alerts/warnings
- Historical weather data
- UI weather widget (use standard equipment card)

## Device Data Points

| Data key                  | Type   | Category          | Unit | Description                                         |
| ------------------------- | ------ | ----------------- | ---- | --------------------------------------------------- |
| condition                 | enum   | weather_condition | —    | sunny/cloudy/partly_cloudy/rainy/snowy/stormy/foggy |
| temperature               | number | temperature       | °C   | Current temperature                                 |
| feels_like                | number | temperature       | °C   | Apparent temperature                                |
| humidity                  | number | humidity          | %    | Relative humidity                                   |
| precipitation             | number | rain              | mm   | Current precipitation                               |
| precipitation_probability | number | rain              | %    | Probability of rain                                 |
| wind_speed                | number | wind              | km/h | Wind speed at 10m                                   |
| wind_gusts                | number | wind              | km/h | Wind gusts                                          |
| uv_index                  | number | uv                | —    | UV index (0-11+)                                    |
| cloud_cover               | number | generic           | %    | Cloud coverage                                      |
| solar_radiation           | number | solar_radiation   | W/m² | Global solar radiation                              |
| forecast_temp_min         | number | temperature       | °C   | Today's minimum temperature                         |
| forecast_temp_max         | number | temperature       | °C   | Today's maximum temperature                         |
| forecast_rain_today       | number | rain              | mm   | Today's total precipitation forecast                |

## Open-Meteo API

### Endpoint

```
GET https://api.open-meteo.com/v1/forecast
  ?latitude={lat}
  &longitude={lon}
  &current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,uv_index,direct_radiation
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max
  &timezone=auto
  &forecast_days=1
```

### WMO Weather Code Mapping

| Code         | Condition     |
| ------------ | ------------- |
| 0            | sunny         |
| 1, 2         | partly_cloudy |
| 3            | cloudy        |
| 45, 48       | foggy         |
| 51-67, 80-82 | rainy         |
| 71-77, 85-86 | snowy         |
| 95-99        | stormy        |

## Edge Cases

- Lat/lon not configured → status "not_configured", no polling
- Open-Meteo API down → status "error", retry with backoff
- Invalid API response → log error, keep last known data
- Plugin installed but Sowel has no home settings → prompt user to set home location
