# Implementation Plan: Weather Forecast Plugin

## Tasks

### Sowel Core

1. [ ] Add DataCategory values (weather_condition, uv, solar_radiation) to types.ts
2. [ ] Add weather-forecast entry to plugins/registry.json
3. [ ] TypeScript compile + tests pass
4. [ ] Commit and push branch

### Plugin (separate repo)

5. [ ] Create GitHub repo mchacher/sowel-plugin-weather-forecast
6. [ ] Create manifest.json, package.json, tsconfig.json
7. [ ] Implement src/index.ts (Open-Meteo polling, device creation, data updates)
8. [ ] Build and verify dist/index.js
9. [ ] Create README.md
10. [ ] Commit, push, create GitHub release with dist/

### End-to-End Testing

11. [ ] Install plugin from Sowel store
12. [ ] Verify device "Weather Forecast" appears in Appareils
13. [ ] Verify data points update every 30 minutes
14. [ ] Create Equipment bound to forecast device
15. [ ] Verify data flows to equipment and zone

### Finalize

16. [ ] Create PR for Sowel core changes
17. [ ] Merge after validation

## Dependencies

- Plugin engine (specs/040-plugin-engine/) must be merged — DONE

## Testing

- Install plugin via store UI or API
- Check device in GET /api/v1/devices — should have 14 data points
- Check data values are reasonable (temperature, humidity, etc.)
- Uninstall and reinstall — verify clean cycle
- Verify polling interval respects configured value
