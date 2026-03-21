# Weather Forecast Equipment Type + Widget

## Summary

Add a new `weather_forecast` equipment type with auto-binding and a dedicated visual widget showing forecast cards (1 to 7 days). When a user creates an equipment of this type and binds it to a weather forecast device, all `jX_*` data points are automatically bound. The widget adapts to the number of days available.

## Acceptance Criteria

- [ ] New EquipmentType `weather_forecast` added
- [ ] Auto-binding: creating a weather*forecast equipment bound to a device auto-creates all jX*\* bindings
- [ ] Widget displays forecast cards (1 per day) with: condition icon, temp min/max, rain probability, wind gusts
- [ ] Widget adapts to number of days (1 to 7 columns)
- [ ] Mobile responsive: horizontal scroll on small screens
- [ ] Condition enum mapped to weather icons (sun, cloud, rain, snow, storm, fog)
- [ ] Equipment visible on Home page and Dashboard
- [ ] Works with the weather-forecast plugin device

## Scope

### In Scope

- EquipmentType `weather_forecast` in types.ts
- Auto-binding logic in equipment-manager for weather_forecast type
- Forecast widget component (WeatherForecastCard)
- Day name localization (lundi, mardi... or Monday, Tuesday...)
- Weather condition → Lucide icon mapping
- Integration in existing equipment rendering pipeline

### Out of Scope

- Hourly forecast view
- Weather alerts
- Historical weather chart
- Custom widget positioning on dashboard

## Widget Design

Each day card (inspired by Netatmo):

```
┌──────────────┐
│   lundi      │
│              │
│    ⛅        │  ← condition icon
│              │
│   14°C       │  ← temp max (bold)
│    2°C       │  ← temp min (lighter)
│              │
│  💧 0.10 mm  │  ← rain probability or precipitation
│  💨 13 km/h  │  ← wind gusts
│              │
└──────────────┘
```

Cards are displayed horizontally, scrollable on mobile.

## Auto-Binding Logic

When an equipment of type `weather_forecast` is created with a device binding:

1. Read all device data keys matching pattern `j{N}_{metric}`
2. For each key, create an equipment data binding: `alias = key, source = device.{key}`
3. No manual binding configuration needed

## Weather Condition Icons (Lucide)

| Condition     | Icon           |
| ------------- | -------------- |
| sunny         | Sun            |
| partly_cloudy | CloudSun       |
| cloudy        | Cloud          |
| foggy         | CloudFog       |
| rainy         | CloudRain      |
| snowy         | Snowflake      |
| stormy        | CloudLightning |
