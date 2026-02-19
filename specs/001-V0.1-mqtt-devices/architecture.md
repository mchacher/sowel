# Architecture: V0.1 MQTT + Devices

## Data Model

### New SQLite Tables

```sql
-- Migration: 001_devices.sql

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  mqtt_base_topic TEXT NOT NULL,
  mqtt_name TEXT NOT NULL,
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  ieee_address TEXT,
  zone_id TEXT,                        -- No FK to zones yet (V0.3)
  source TEXT NOT NULL DEFAULT 'zigbee2mqtt',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen DATETIME,
  raw_expose JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mqtt_base_topic, mqtt_name)
);

CREATE TABLE device_data (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generic',
  value TEXT,                          -- JSON-encoded
  unit TEXT,
  last_updated DATETIME,
  UNIQUE(device_id, key)
);

CREATE TABLE device_orders (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  mqtt_set_topic TEXT NOT NULL,
  payload_key TEXT NOT NULL,
  min_value REAL,
  max_value REAL,
  enum_values JSON,
  unit TEXT,
  UNIQUE(device_id, key)
);
```

### New Types in types.ts

```typescript
// Device entity
interface Device { ... }                // Per spec §5.2
type DeviceSource = "zigbee2mqtt" | "tasmota" | "esphome" | "shelly" | "custom_mqtt";
type DeviceStatus = "online" | "offline" | "unknown";

// Device Data
interface DeviceData { ... }            // Per spec §5.2
type DataType = "boolean" | "number" | "enum" | "text" | "json";
type DataCategory = "motion" | "temperature" | ... | "generic";  // Full list from spec

// Device Order
interface DeviceOrder { ... }           // Per spec §5.2

// Event Bus
type EngineEvent = ...                  // Discriminated union, per spec §6 (device + system events only for V0.1)
```

## Event Bus Events

### Events Emitted

| Event | Source | Payload |
|-------|--------|---------|
| `device.discovered` | Device Manager | `{ device: Device }` |
| `device.removed` | Device Manager | `{ deviceId: string }` |
| `device.status_changed` | Device Manager | `{ deviceId: string, status: DeviceStatus }` |
| `device.data.updated` | Device Manager | `{ deviceId: string, dataId: string, key: string, value: any, previous: any, timestamp: Date }` |
| `system.started` | index.ts | `{}` |
| `system.mqtt.connected` | MQTT Connector | `{}` |
| `system.mqtt.disconnected` | MQTT Connector | `{}` |

### Events Consumed

| Consumer | Events Listened |
|----------|----------------|
| WebSocket Handler | All events (broadcasts to connected clients) |

## MQTT Topics

### Subscribed Topics

| Topic | Purpose | Handler |
|-------|---------|---------|
| `zigbee2mqtt/bridge/devices` | Retained device list (auto-discovery) | zigbee2mqtt parser |
| `zigbee2mqtt/bridge/event` | Device join/leave/rename events | zigbee2mqtt parser |
| `zigbee2mqtt/+` | Device state messages (JSON payloads) | zigbee2mqtt parser → Device Manager |
| `zigbee2mqtt/+/availability` | Device online/offline status | zigbee2mqtt parser → Device Manager |

### Messages Published

None in V0.1 (order execution is V0.2).

## API Changes

### New Endpoints

| Method | Route | Response | Description |
|--------|-------|----------|-------------|
| `GET` | `/api/v1/health` | `{ status, mqtt, devices, uptime }` | Engine health check |
| `GET` | `/api/v1/devices` | `Device[]` with current Data values | List all devices |
| `GET` | `/api/v1/devices/:id` | `Device` with Data[] and Orders[] | Get device detail |
| `PUT` | `/api/v1/devices/:id` | `Device` | Update device (name, zoneId) |
| `DELETE` | `/api/v1/devices/:id` | `204 No Content` | Remove device |
| `GET` | `/api/v1/devices/:id/raw` | `{ expose: object }` | Raw zigbee2mqtt expose data |

### WebSocket

| Path | Protocol | Description |
|------|----------|-------------|
| `/ws` | WebSocket | Broadcasts all EngineEvent as JSON frames |

No authentication required in V0.1. No subscription filtering in V0.1 (all events sent to all clients).

## File Changes

| File | Change |
|------|--------|
| `package.json` | New — project init with dependencies |
| `tsconfig.json` | New — TypeScript strict config |
| `.env.example` | New — environment variable template |
| `.gitignore` | New — node_modules, data/, dist/, .env |
| `src/shared/types.ts` | New — Device, DeviceData, DeviceOrder, EngineEvent types |
| `src/shared/constants.ts` | New — DataCategory inference maps, DeviceSource values |
| `src/config.ts` | New — load and validate env config |
| `src/core/event-bus.ts` | New — typed EventEmitter |
| `src/core/database.ts` | New — SQLite connection, migration runner |
| `src/core/logger.ts` | New — pino logger factory |
| `src/mqtt/mqtt-connector.ts` | New — MQTT client wrapper |
| `src/mqtt/parsers/zigbee2mqtt.ts` | New — z2m bridge/devices + state parser |
| `src/devices/device-manager.ts` | New — Device CRUD + auto-discovery |
| `src/devices/category-inference.ts` | New — DataCategory inference from expose |
| `src/api/server.ts` | New — Fastify setup + plugin registration |
| `src/api/websocket.ts` | New — WebSocket handler |
| `src/api/routes/devices.ts` | New — Device REST routes |
| `src/api/routes/health.ts` | New — Health check route |
| `src/index.ts` | New — Bootstrap everything |
| `migrations/001_devices.sql` | New — Device tables |
| `scripts/test-api.sh` | New — API test helper script |

## Startup Sequence

```
1. Load config from .env
2. Initialize pino logger
3. Open SQLite database, run migrations
4. Create Event Bus
5. Create MQTT Connector (connect to broker)
6. Create Device Manager (wires to Event Bus + DB)
7. Create zigbee2mqtt parser (wires to MQTT Connector + Device Manager)
8. Start Fastify server (registers routes + WebSocket)
9. Emit "system.started" event
10. Log device summary
```

## Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| `fastify` | ^5.x | HTTP framework |
| `@fastify/websocket` | ^11.x | WebSocket support |
| `mqtt` | ^5.x | MQTT client |
| `better-sqlite3` | ^11.x | SQLite driver |
| `dotenv` | ^16.x | .env loading |
| `pino` | (via Fastify) | Structured logging |

### Development

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.x | TypeScript compiler |
| `tsx` | ^4.x | Dev runner with hot reload |
| `@types/better-sqlite3` | ^7.x | SQLite types |
| `@types/node` | ^20.x | Node.js types |
| `vitest` | ^2.x | Test runner |
