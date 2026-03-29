# 048a — Externalize Netatmo Weather as Plugin

## Summary

Extract the weather station polling from the built-in Netatmo HC integration into an external plugin `sowel-plugin-netatmo-weather`. Read-only plugin — discovers weather station + outdoor modules, polls temperature, humidity, pressure, CO2, noise, rain, wind data.

## Current State

- Weather polling lives inside `src/integrations/netatmo-hc/netatmo-poller.ts` (methods: `pollWeather()`, lines ~370-430)
- Weather types in `netatmo-types.ts` (`mapWeatherStationToDiscovered`, `mapWeatherModuleToDiscovered`, `extractWeatherPayload`)
- OAuth bridge in `netatmo-bridge.ts` (shared with Control/Energy — will be duplicated into plugin)
- Activated by setting `enable_weather = true`
- Integration ID: `netatmo_hc`, source: `netatmo_hc`

## Acceptance Criteria

- [x] New repo `mchacher/sowel-plugin-netatmo-weather`
- [x] Plugin implements `IntegrationPlugin` via `createPlugin(deps)`
- [x] Discovers weather station + outdoor/indoor/rain/wind modules as devices
- [x] Polls getstationsdata API at configurable interval
- [x] OAuth authentication with token rotation + file persistence
- [x] Integration ID: `netatmo_weather` (new ID, separate from legacy `netatmo_hc`)
- [x] Settings prefix: `integration.netatmo_weather.*`
- [x] Pre-built tarball release via GitHub Actions
- [x] Added to `plugins/registry.json`
- [x] No orders (read-only)
- [x] Token file: `data/netatmo-weather-tokens.json` (separate from control)
- [x] Device migration: on first start, migrated 4 weather devices from `netatmo_hc` to `netatmo_weather`
- [x] Weather code removed from built-in `netatmo-hc` integration (no regression — Legrand H+C still 10 devices, connected)

## Scope

### In Scope

- Weather station device discovery (base station + modules)
- Data polling: temperature, humidity, pressure, CO2, noise, rain, wind, battery
- OAuth bridge (duplicated from netatmo-bridge.ts, self-contained)
- Token rotation + persistence to file

### Out of Scope

- Home+Control devices (048b)
- Energy monitoring (048c)
- Removing weather code from built-in integration (done when all 3 plugins are complete)

## Edge Cases

- Token expired → auto-refresh via bridge
- Weather station offline → device marked offline on next poll
- No weather modules → empty discovery, no error
