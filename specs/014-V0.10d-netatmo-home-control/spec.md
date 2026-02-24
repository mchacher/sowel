# V0.10d: Netatmo Home+Control Integration

## Summary

Integration plugin for Legrand Home+Control devices via the Netatmo Connect cloud API. Exposes teleruptors, contactors, and energy meters as Corbel devices with polling-based state updates and order execution via REST API.

## Reference

- Netatmo Connect API: https://dev.netatmo.com/apidocumentation/control
- Corbel spec: Integration Plugin Architecture (V0.10a)
- Existing plugins: Panasonic CC (V0.10b), MCZ Maestro (V0.10c)

## Acceptance Criteria

- [ ] Plugin appears in Administration > Integrations with status "not_configured"
- [ ] After entering client_id, client_secret, refresh_token → status becomes "connected"
- [ ] All Legrand modules appear as Devices in Corbel (teleruptors, contactors, energy meters)
- [ ] Teleruptor/contactor state (on/off) is polled and visible as DeviceData
- [ ] Energy meter readings (power W, energy Wh) are polled and visible as DeviceData
- [ ] Executing an order on a teleruptor/contactor sends `setstate` to Netatmo API
- [ ] On-demand poll (10s delay) after order execution to confirm state change
- [ ] OAuth2 access token is auto-refreshed (3h lifetime) with persistent refresh_token rotation
- [ ] Token refresh failure sets status to "error" with clear log message
- [ ] Polling interval is configurable (default 300s)
- [ ] TypeScript compiles with zero errors
- [ ] All existing tests still pass

## Scope

### In Scope

- OAuth2 token management (refresh_token rotation, persistent storage)
- Device discovery via `/api/homesdata` (flat list of modules, topology ignored)
- State polling via `/api/homestatus`
- Order execution via `/api/setstate` (on/off for switches/contactors)
- Energy meter data (power, sum_energy_elec)
- Configurable polling interval
- On-demand poll after order execution

### Out of Scope

- Full OAuth2 browser redirect flow (user provides refresh_token manually from dev portal)
- Netatmo topology mapping to Corbel zones (user creates their own)
- Netatmo webhooks (not available for Home+Control)
- Netatmo weather station / camera / thermostat devices (different scopes)
- UI components specific to Netatmo devices
- Unit tests for the plugin (manual verification with real API)

## Edge Cases

- Token expired and refresh fails → status = "error", log message, plugin stops polling
- Rate limit hit (HTTP 429) → log warning, skip poll cycle, retry on next interval
- Module offline in Netatmo → still reported in homestatus with last known values
- home_id auto-detection: use first home returned by `/api/homesdata`
- Empty module list → plugin stays "connected" but no devices created
- Network error during poll → log error, continue polling on next interval
