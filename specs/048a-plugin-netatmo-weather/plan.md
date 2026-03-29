# Implementation Plan: 048a — Netatmo Weather Plugin

## Tasks

### Plugin repo creation

1. [ ] Create GitHub repo `mchacher/sowel-plugin-netatmo-weather`
2. [ ] Scaffold plugin structure: `manifest.json`, `package.json`, `tsconfig.json`, `.gitignore`, `src/index.ts`
3. [ ] Port OAuth bridge code from `netatmo-bridge.ts` (auth, token rotation, file persistence)
4. [ ] Port weather polling code from `netatmo-poller.ts` (`pollWeatherStation()`)
5. [ ] Port weather types from `netatmo-types.ts` (station/module mapping, payload extraction)
6. [ ] Implement `createPlugin(deps)` → `IntegrationPlugin` (read-only, no executeOrder)
7. [ ] Add `.github/workflows/release.yml` (pre-built tarball)
8. [ ] Build locally, verify `dist/index.js` works

### Device migration (preserve equipments + bindings)

9. [ ] Add `migrateDevicesFromLegacy()` to plugin: on first start, UPDATE existing devices with `integration_id = 'netatmo_hc'` and matching `source_device_id` to `integration_id = 'netatmo_weather'`
10. [ ] Expose `db` in `PluginDeps` (or add a `deviceManager.migrateIntegrationId()` helper)

### Sowel core cleanup

11. [ ] Remove weather code from `netatmo-poller.ts` (pollWeatherStation, weatherNames, enableWeather)
12. [ ] Remove `enable_weather` setting from `index.ts`
13. [ ] Remove `getStationsData()` from `netatmo-bridge.ts`
14. [ ] Remove weather types from `netatmo-types.ts`
15. [ ] Add `netatmo-weather` to `plugins/registry.json`

### Validation

16. [ ] TypeScript compilation (Sowel backend + frontend)
17. [ ] All tests pass
18. [ ] Lint passes (0 errors)
19. [ ] Tag + release plugin v1.0.0 (GitHub Actions creates pre-built tarball)
20. [ ] Install plugin from store via UI (Playwright)
21. [ ] Configure plugin settings (client_id, secret, refresh_token) — same credentials as netatmo_hc
22. [ ] Verify weather devices migrated (same UUIDs, equipments preserved)
23. [ ] Verify data polling works (temperature, humidity, etc.)
24. [ ] Verify built-in integration still works for Control + Energy (no regression)
25. [ ] Deploy UI via `deploy-ui.sh`

## Testing Strategy

### Pre-implementation: capture current state

- Note current weather devices and their data in the UI (Playwright screenshot)
- These devices will disappear when built-in weather code is removed
- They should reappear after plugin install + configuration

### Post-implementation: validate via Playwright

1. Navigate to Plugins page → install Netatmo Weather from store
2. Navigate to Integrations page → configure netatmo_weather settings (same credentials as netatmo_hc)
3. Wait for first poll → navigate to Devices page → verify weather station + modules appear
4. Verify data values are populated (temperature, humidity, etc.)
5. Verify built-in Legrand H+C integration still shows Control devices (no regression)

### Credentials for testing

- Same Netatmo OAuth credentials as current `netatmo_hc` integration
- Settings keys will be different: `integration.netatmo_weather.client_id` etc.
- Need to configure via API or UI after plugin install
