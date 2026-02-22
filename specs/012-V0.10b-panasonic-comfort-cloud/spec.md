# V0.10b: Panasonic Comfort Cloud Integration

## Summary

Add a Panasonic Comfort Cloud integration plugin that discovers AC units from the Panasonic cloud API, exposes them as Devices with Data and Orders, and allows controlling them from the Corbel UI. Introduces the `thermostat` EquipmentType with a dedicated dashboard widget. Uses polling-based data updates with configurable interval (default 5 min) and on-demand polling after order execution.

## Reference

- Spec sections: §4 (Devices), §6 (Equipments), §15 (UI Design System)
- Depends on: V0.10a (Integration Plugin Architecture)
- API reference: `aio-panasonic-comfort-cloud` Python library (TypeScript port)

## Acceptance Criteria

- [ ] `PanasonicCCIntegration implements IntegrationPlugin` is registered in the IntegrationRegistry
- [ ] User can enter Panasonic email/password in the IntegrationsPage UI
- [ ] OAuth2/Auth0 PKCE authentication flow works (login, token refresh, session recovery)
- [ ] AC units are discovered as Devices with source `panasonic_cc`
- [ ] Each AC unit exposes Data: power, operationMode, targetTemperature, insideTemperature, outsideTemperature, fanSpeed, airSwingUD, airSwingLR, ecoMode, nanoe
- [ ] Each AC unit exposes Orders: setPower, setMode, setTargetTemperature, setFanSpeed, setSwingUD, setSwingLR, setEcoMode, setNanoe
- [ ] Orders are executed via the Panasonic cloud API (`/deviceStatus/control`)
- [ ] Polling interval is configurable (default 300s / 5 min)
- [ ] After order execution, a confirmation poll runs after a configurable delay (default 10s)
- [ ] Requests are serialized (single concurrency) to avoid rate limiting
- [ ] Token refresh is automatic when access token expires
- [ ] `thermostat` EquipmentType is added to the system
- [ ] A thermostat widget in the dashboard shows temperature + controls
- [ ] Feature flags from device capabilities are respected (e.g., nanoe available or not)
- [ ] TypeScript compiles with zero errors (backend + frontend)

## Scope

### In Scope

- Panasonic CC integration plugin (auth, discovery, polling, orders)
- OAuth2/Auth0 PKCE authentication flow (TypeScript implementation)
- Token persistence in SettingsManager (encrypted in DB)
- Device discovery from `/device/group` API
- Device status polling from `/deviceStatus/now/{guid}` (cached endpoint)
- Order execution via `/deviceStatus/control`
- Configurable polling interval (settings)
- On-demand poll after order execution (with delay)
- Request serialization (mutex)
- `thermostat` EquipmentType
- Thermostat dashboard widget (temperature display, mode selector, target temp control)
- IntegrationsPage: Panasonic CC card with email/password form + status
- Translations (FR/EN)

### Out of Scope

- Aquarea heat pump devices (different protocol, deferred)
- Energy/history data from Panasonic API (deferred to V0.11 History)
- Zone parameters for ducted systems (multi-zone AC, rare)
- App version auto-update from Play Store scraping (use hardcoded version)
- Multi-account support (one Panasonic account per Corbel instance)

## Edge Cases

- What if Panasonic credentials are wrong? → LoginError, integration status "error", UI shows error message.
- What if access token expires during polling? → Auto-refresh via refresh_token. If refresh fails, re-authenticate with stored credentials.
- What if the Panasonic API is unreachable? → Integration status "disconnected", devices keep last known values, retry on next poll cycle.
- What if rate limited? → Respect serialization, log warning, back off polling interval temporarily.
- What if a device is offline (AC unit unplugged)? → Device status "offline", Data values stale, orders return error.
- What if API returns 401 with code 4106? → App version mismatch. Log error, retry with updated version header.
- What if live status request fails? → Fall back to cached endpoint (`/deviceStatus/now/{guid}`) for next N requests.
- What if insideTemperature = 126? → Invalid sensor reading, expose as `null`.
- What if user has no AC units? → Integration connected, zero devices discovered, UI shows "no devices found".
