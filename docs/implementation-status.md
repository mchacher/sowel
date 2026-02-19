# Corbel — Implementation Status

> Updated: 2026-02-19 — V0.1

## Versions

| Version | Feature | Status |
|---------|---------|--------|
| **V0.1** | MQTT + Devices | ✅ Done |
| V0.2 | Equipments + Bindings | — |
| V0.3 | Zones + Aggregation | — |
| V0.4 | UI + Real-time | — |
| V0.5 | Computed Data | — |
| V0.6 | History (InfluxDB) | — |
| V0.7 | Scenario Engine | — |
| V0.8 | Recipes | — |
| V0.9 | Polish | — |
| V1.0+ | AI Assistant | — |

---

## V0.1 — MQTT + Devices

**Objective**: Connect to zigbee2mqtt, auto-discover all Zigbee devices, track their state in real-time, persist in SQLite.

### What it does

- Connects to an MQTT broker and subscribes to zigbee2mqtt topics
- Auto-discovers devices from `zigbee2mqtt/bridge/devices` (parses exposes)
- Creates DeviceData (readable properties) and DeviceOrders (writable properties) for each device
- Infers DataCategory from property names (occupancy→motion, temperature→temperature, brightness→light_brightness, etc.)
- Tracks device state in real-time via MQTT state messages
- Marks devices online when they send data
- Persists everything in SQLite (WAL mode)
- Broadcasts all events via WebSocket

### API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/health` | Engine status (MQTT, device count, uptime) |
| GET | `/api/v1/devices` | List all devices with current data |
| GET | `/api/v1/devices/:id` | Device detail with Data + Orders |
| PUT | `/api/v1/devices/:id` | Update device name or zoneId |
| DELETE | `/api/v1/devices/:id` | Remove device |
| GET | `/api/v1/devices/:id/raw` | Raw zigbee2mqtt expose data |
| WS | `/ws` | WebSocket — broadcasts all engine events |

### Event Bus Events

| Event | When |
|-------|------|
| `device.discovered` | New device found in zigbee2mqtt |
| `device.removed` | Device disappeared or deleted |
| `device.status_changed` | Device goes online/offline |
| `device.data.updated` | A device property value changes |
| `system.started` | Engine boot complete |
| `system.mqtt.connected` | MQTT broker connected |
| `system.mqtt.disconnected` | MQTT broker disconnected |

### Architecture

```
MQTT Broker (zigbee2mqtt)
  │
  ├─ zigbee2mqtt/bridge/devices  → Z2M Parser → Device Manager (upsert)
  ├─ zigbee2mqtt/bridge/event    → Z2M Parser (new device joins)
  ├─ zigbee2mqtt/+               → Z2M Parser → Device Manager (update data)
  └─ zigbee2mqtt/+/availability  → Z2M Parser → Device Manager (update status)
                                        │
                                   Event Bus
                                        │
                                   WebSocket → clients
```

### Files

| Module | Files |
|--------|-------|
| Shared | `src/shared/types.ts`, `src/shared/constants.ts` |
| Core | `src/config.ts`, `src/core/logger.ts`, `src/core/event-bus.ts`, `src/core/database.ts` |
| MQTT | `src/mqtt/mqtt-connector.ts`, `src/mqtt/parsers/zigbee2mqtt.ts` |
| Devices | `src/devices/device-manager.ts`, `src/devices/category-inference.ts` |
| API | `src/api/server.ts`, `src/api/websocket.ts`, `src/api/routes/devices.ts`, `src/api/routes/health.ts` |
| Entry | `src/index.ts` |
| DB | `migrations/001_devices.sql` |
| Tests | `src/devices/category-inference.test.ts`, `src/devices/device-manager.test.ts`, `src/core/event-bus.test.ts` |

### Tests

51 unit tests — `npm test`

### Quick Start

```bash
cp .env.example .env     # Edit MQTT_URL
npm install
npm run dev              # Start engine
curl localhost:3000/api/v1/health
curl localhost:3000/api/v1/devices
websocat ws://localhost:3000/ws
```
