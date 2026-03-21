# Architecture: Weather Forecast Plugin

## Two Deliverables

### 1. Sowel Core Changes (branch feat/weather-forecast-plugin)

Minimal changes to support the plugin.

#### types.ts — New DataCategory values

```typescript
export type DataCategory =
  // ... existing values ...
  | "weather_condition" // NEW — weather state (sunny, cloudy, rainy, etc.)
  | "uv" // NEW — UV index
  | "solar_radiation" // NEW — solar radiation (W/m²)
  | "generic";
```

#### plugins/registry.json — New entry

```json
{
  "id": "weather-forecast",
  "name": "Weather Forecast",
  "description": "Weather forecast via Open-Meteo API (free, no API key)",
  "icon": "CloudSun",
  "author": "mchacher",
  "repo": "mchacher/sowel-plugin-weather-forecast",
  "version": "0.1.0",
  "tags": ["weather", "forecast", "open-meteo"]
}
```

### 2. Plugin (separate GitHub repo: mchacher/sowel-plugin-weather-forecast)

#### Plugin Structure

```
sowel-plugin-weather-forecast/
  manifest.json        ← plugin metadata + settings schema
  package.json         ← npm config (no external deps)
  tsconfig.json        ← TypeScript config
  src/index.ts         ← plugin implementation
  dist/index.js        ← compiled output (included in release)
  README.md            ← installation & usage guide
  .gitignore
```

#### manifest.json

```json
{
  "id": "weather-forecast",
  "name": "Weather Forecast",
  "version": "0.1.0",
  "description": "Weather forecast via Open-Meteo API (free, no API key)",
  "icon": "CloudSun",
  "author": "mchacher",
  "sowelVersion": ">=0.10.0",
  "settings": [
    {
      "key": "polling_interval",
      "label": "Polling interval (minutes)",
      "type": "number",
      "required": false,
      "defaultValue": "30",
      "placeholder": "Min 15, default 30"
    }
  ]
}
```

#### Configuration

- **Lat/lon**: read from Sowel settings `home.latitude` and `home.longitude`
- **Polling interval**: from plugin settings, in minutes (default 30, minimum 15)
- **No API key needed**: Open-Meteo is fully free

#### Data Flow

```
Open-Meteo API (every 30 min)
  → Plugin polls /v1/forecast
    → deviceManager.upsertFromDiscovery("weather-forecast", "open-meteo", {...})
    → deviceManager.updateDeviceData("weather-forecast", "open-meteo", {...})
      → EventBus: "device.data.updated"
        → Equipment bindings evaluate
          → Zone aggregation (temperature, humidity)
            → Scenarios can trigger on forecast data
```

## File Changes

### Sowel Core

| File                    | Change                     |
| ----------------------- | -------------------------- |
| `src/shared/types.ts`   | Add 3 DataCategory values  |
| `plugins/registry.json` | Add weather-forecast entry |

### Plugin (separate repo)

| File            | Description                |
| --------------- | -------------------------- |
| `manifest.json` | Plugin metadata            |
| `package.json`  | npm config                 |
| `tsconfig.json` | TypeScript config          |
| `src/index.ts`  | Full plugin implementation |
| `README.md`     | Documentation              |
