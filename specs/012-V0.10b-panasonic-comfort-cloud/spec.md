# V0.10b: Panasonic Comfort Cloud Integration

## Summary

Add a Panasonic Comfort Cloud integration plugin that discovers AC units from the Panasonic cloud API, exposes them as Devices with Data and Orders, and allows controlling them from the Winch UI. Uses a **Python bridge** wrapping the community-maintained `aio-panasonic-comfort-cloud` library (Home Assistant ecosystem) for authentication and API calls. Introduces the `thermostat` EquipmentType with a dedicated dashboard widget. Uses polling-based data updates with configurable interval (default 5 min) and on-demand polling after order execution.

## Reference

- Spec sections: §4 (Devices), §6 (Equipments), §15 (UI Design System)
- Depends on: V0.10a (Integration Plugin Architecture)
- Python library: [aio-panasonic-comfort-cloud](https://pypi.org/project/aio-panasonic-comfort-cloud/) (HA community)

## Design Decision

**Python bridge instead of TypeScript port.** The Panasonic API auth flow (OAuth2/PKCE via Auth0) is complex and changes frequently. The Home Assistant community maintains `aio-panasonic-comfort-cloud` which handles auth, token refresh, app version detection, and API headers. We wrap it via a CLI bridge script called from Node.js (`child_process.execFile`), avoiding the need to port and maintain the auth logic ourselves. A `pip install --upgrade` follows HA community updates.

## Acceptance Criteria

- [ ] `PanasonicCCIntegration implements IntegrationPlugin` is registered in the IntegrationRegistry
- [ ] Python bridge script (`bridge.py`) wraps `aio-panasonic-comfort-cloud` with JSON CLI interface
- [ ] User can enter Panasonic email/password in the IntegrationsPage UI
- [ ] AC units are discovered as Devices with source `panasonic_cc`
- [ ] Each AC unit exposes Data: power, operationMode, targetTemperature, insideTemperature, outsideTemperature, fanSpeed, airSwingUD, airSwingLR, ecoMode, nanoe
- [ ] Each AC unit exposes Orders: power, operationMode, targetTemperature, fanSpeed, airSwingUD, airSwingLR, ecoMode, nanoe
- [ ] Orders are executed via the Python bridge → Panasonic cloud API
- [ ] Polling interval is configurable (default 300s / 5 min)
- [ ] After order execution, a confirmation poll runs after a configurable delay (default 10s)
- [ ] Token persistence via file (handled by Python library)
- [ ] `thermostat` EquipmentType is added to the system
- [ ] A thermostat widget in the dashboard shows temperature + controls
- [ ] Feature flags from device capabilities are respected (e.g., nanoe available or not)
- [ ] TypeScript compiles with zero errors (backend + frontend)
- [ ] Python 3.10+ is documented as a runtime dependency

## Scope

### In Scope

- Panasonic CC integration plugin (Python bridge + TypeScript wrapper)
- Python bridge script (`bridge.py`) with commands: login, get_devices, get_device, control
- Token persistence via `aio-panasonic-comfort-cloud` native file storage
- Device discovery from Python bridge output
- Device status polling (configurable interval, on-demand after orders)
- Order execution via Python bridge
- `thermostat` EquipmentType
- Thermostat dashboard widget (temperature display, mode selector, target temp control)
- IntegrationsPage: Panasonic CC card with email/password form + status (dynamic from V0.10a)
- Translations (FR/EN)
- `requirements.txt` for Python dependencies

### Out of Scope

- Aquarea heat pump devices (different protocol, deferred)
- Energy/history data from Panasonic API (deferred)
- Zone parameters for ducted systems (multi-zone AC, rare)
- Multi-account support (one Panasonic account per Winch instance)
- Docker configuration for Python runtime (deferred)

## Edge Cases

- What if Python 3.10+ is not installed? → Integration status "error", log clear message about missing dependency.
- What if Panasonic credentials are wrong? → Bridge returns `{"ok": false, "error": "..."}`, integration status "error", UI shows message.
- What if token expires? → Python library handles refresh automatically; if refresh fails, re-authenticates with stored credentials.
- What if Panasonic API is unreachable? → Bridge returns error JSON, integration status "disconnected", devices keep last known values, retry on next poll.
- What if rate limited? → Polling serializes requests (one Python invocation at a time), log warning.
- What if a device is offline? → Device status "offline", Data values stale, orders return error.
- What if insideTemperature = 126? → Bridge maps to `null` (invalid sensor reading).
- What if user has no AC units? → Integration connected, zero devices discovered, UI shows "no devices found".
- What if Python bridge process hangs? → 30s timeout on child_process, kill and return error.
