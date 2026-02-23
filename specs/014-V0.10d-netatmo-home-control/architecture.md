# Architecture: V0.10d Netatmo Home+Control

## Data Model Changes

### types.ts

Add `"netatmo_hc"` to `DeviceSource` union.

No new SQLite tables — uses existing `devices`, `device_data`, `device_orders` tables.
Token persistence via `data/netatmo-tokens.json` file (same pattern as Panasonic).

## Event Bus Events

### Emitted

- `system.integration.connected` (integrationId: "netatmo_hc")
- `system.integration.disconnected` (integrationId: "netatmo_hc")
- `device.discovered` (via DeviceManager.upsertFromDiscovery)
- `device.data.updated` (via DeviceManager.updateDeviceData)
- `device.heartbeat` (via DeviceManager.updateDeviceData)
- `device.status_changed` (via DeviceManager.updateDeviceData)

### Consumed

None (polling-based, no event-driven triggers).

## API Changes

No new REST endpoints. Uses existing:

- `GET /api/v1/integrations` — lists all integrations including netatmo_hc
- `PUT /api/v1/integrations/:id/settings` — configure credentials
- `POST /api/v1/integrations/:id/start` — start plugin
- `POST /api/v1/integrations/:id/stop` — stop plugin

## Netatmo API Endpoints Used

| Endpoint                    | Method | Purpose                                                 |
| --------------------------- | ------ | ------------------------------------------------------- |
| `/oauth2/token`             | POST   | Refresh access token (grant_type=refresh_token)         |
| `/api/homesdata`            | GET    | Discover modules (one-time at start, then on each poll) |
| `/api/homestatus?home_id=X` | GET    | Poll current state of all modules                       |
| `/api/setstate`             | POST   | Execute orders (on/off, position, etc.)                 |

## Module Type → Device Mapping

| Legrand Type | Description  | DeviceData keys                                   | DataCategory                      | DeviceOrders                                 |
| ------------ | ------------ | ------------------------------------------------- | --------------------------------- | -------------------------------------------- |
| NLPT         | Teleruptor   | `on` (boolean)                                    | `generic`                         | `on` (boolean) → setstate `{on: true/false}` |
| NLPO         | Contactor    | `on` (boolean)                                    | `generic`                         | `on` (boolean) → setstate `{on: true/false}` |
| NLL          | Light switch | `on` (boolean)                                    | `light_state`                     | `on` (boolean)                               |
| NLF/NLFE     | Dimmer       | `on` (boolean), `brightness` (number)             | `light_state`, `light_brightness` | `on`, `brightness`                           |
| NLV/NLLV     | Shutter      | `current_position` (number 0-100)                 | `shutter_position`                | `target_position` (number)                   |
| NLPC         | Energy meter | `power` (number W), `sum_energy_elec` (number Wh) | `power`, `energy`                 | —                                            |
| NLP          | Smart plug   | `on` (boolean)                                    | `generic`                         | `on` (boolean)                               |
| NLPD         | Dry contact  | `on` (boolean)                                    | `generic`                         | `on` (boolean)                               |
| NLG/NLGS     | Gateway      | `wifi_strength` (number)                          | `generic`                         | —                                            |

Note: Only types present in the user's home will generate devices. Unknown types are logged and skipped.

## dispatchConfig Shape

```typescript
{
  homeId: string; // Netatmo home ID
  moduleId: string; // Netatmo module ID (e.g. "00:04:74:xx:xx:xx")
  param: string; // "on" | "target_position" | "brightness"
}
```

## OAuth2 Token Flow

```
Startup:
  1. Read refresh_token from settings (user-provided initial value)
  2. POST /oauth2/token { grant_type: refresh_token, refresh_token, client_id, client_secret }
  3. Receive { access_token, refresh_token (new!), expires_in }
  4. Persist new refresh_token to data/netatmo-tokens.json AND update setting
  5. Schedule next refresh at (expires_in - 300) seconds (5 min before expiry)

On refresh failure:
  - Retry once after 30s
  - If still fails → status = "error", stop polling
```

## File Changes

| File                                            | Change                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| `src/shared/types.ts`                           | Add `"netatmo_hc"` to `DeviceSource`                      |
| `src/integrations/netatmo-hc/index.ts`          | **New** — IntegrationPlugin implementation                |
| `src/integrations/netatmo-hc/netatmo-bridge.ts` | **New** — HTTP client + OAuth2 token management           |
| `src/integrations/netatmo-hc/netatmo-poller.ts` | **New** — Polling loop + data mapping                     |
| `src/integrations/netatmo-hc/netatmo-types.ts`  | **New** — Module types, mappings, API response interfaces |
| `src/index.ts`                                  | Import + register NetatmoHCIntegration                    |
