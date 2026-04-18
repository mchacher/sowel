# Spec 076 — Order Dispatch: Netatmo Weather Migration

**Depends on**: spec 067 (core refactoring)

## Summary

Migrate the netatmo-weather plugin to apiVersion 2 for interface coherence. Read-only plugin (executeOrder throws) — no functional change.

## Changes

- `apiVersion: 2` on plugin class
- `executeOrder` signature updated to v2 (still throws)
- Local interfaces updated (IntegrationPlugin, DiscoveredDevice)

## Categories (verified — all correct)

| Data key                           | Category      | Equipment type |
| ---------------------------------- | ------------- | -------------- |
| temperature                        | `temperature` | weather        |
| humidity                           | `humidity`    | weather        |
| co2                                | `co2`         | weather        |
| noise                              | `noise`       | weather        |
| pressure                           | `pressure`    | weather        |
| battery                            | `battery`     | weather        |
| wind*strength, wind_angle, gust*\* | `wind`        | weather        |
| rain, sum*rain*\*                  | `rain`        | weather        |

## Acceptance Criteria

- [x] Plugin declares `apiVersion: 2`
- [x] Local interfaces aligned with v2
- [x] Categories: NAModule1 outdoor → `temperature_outdoor`, `humidity_outdoor`
- [x] New core categories: `temperature_outdoor`, `humidity_outdoor`
- [x] weather-forecast: temp_min/max → `temperature_outdoor`
- [x] panasonic-cc: outsideTemperature → `temperature_outdoor`
- [x] Build succeeds
- [ ] Released as netatmo-weather v2.0.0
- [ ] Registry updated
