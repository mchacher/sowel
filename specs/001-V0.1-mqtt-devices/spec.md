# V0.1: MQTT + Devices

## Summary

The foundational milestone of Sowel. The engine connects to an MQTT broker (zigbee2mqtt), auto-discovers all Zigbee devices, parses their capabilities (Data and Orders), tracks their state in real-time, and persists everything in SQLite. A REST API and WebSocket endpoint expose device data for testing and future UI integration.

## Reference

- Spec sections: §3 (Architecture), §4 (Tech Stack), §5.2 (Device), §6 (Event Bus), §7.6 (Device API), §8 (SQLite Schema — devices tables), §10 (Project Structure), §11 V0.1, §12 (Configuration)

## Acceptance Criteria

- [ ] Engine starts and connects to MQTT broker at configured URL
- [ ] Engine subscribes to `zigbee2mqtt/bridge/devices` and parses the retained device list
- [ ] For each zigbee2mqtt device, a Device record is created in SQLite with: id, mqttBaseTopic, mqttName, name, manufacturer, model, ieeeAddress, source, status
- [ ] The `definition.exposes` array is parsed to generate DeviceData (readable properties) and DeviceOrder (writable properties)
- [ ] DataCategory is inferred from property names (occupancy→motion, temperature→temperature, state on light→light_state, etc.)
- [ ] Engine subscribes to `zigbee2mqtt/<device_name>` state topics and updates DeviceData values in real-time
- [ ] Engine subscribes to `zigbee2mqtt/+/availability` and tracks Device online/offline status
- [ ] Engine listens to `zigbee2mqtt/bridge/event` for new device joins and re-reads the device list
- [ ] Event bus emits typed events: `device.discovered`, `device.removed`, `device.status_changed`, `device.data.updated`, `system.started`, `system.mqtt.connected`, `system.mqtt.disconnected`
- [ ] REST API `GET /api/v1/devices` returns all devices with their current Data values
- [ ] REST API `GET /api/v1/devices/:id` returns a single device with all Data and Orders
- [ ] REST API `PUT /api/v1/devices/:id` allows updating name and zoneId
- [ ] REST API `DELETE /api/v1/devices/:id` removes a device (re-discovered if still on network)
- [ ] REST API `GET /api/v1/health` returns engine status (MQTT connected, device count, uptime)
- [ ] REST API `GET /api/v1/devices/:id/raw` returns raw zigbee2mqtt expose data
- [ ] WebSocket at `ws://host:port/ws` broadcasts all EngineEvent objects as JSON
- [ ] SQLite database is created with WAL mode, migrations run on startup
- [ ] Structured JSON logging via pino
- [ ] TypeScript compiles with zero errors in strict mode
- [ ] On startup, logs a summary of discovered devices

## Scope

### In Scope

- Node.js + TypeScript + Fastify project initialization
- Environment configuration (.env loading)
- SQLite database with `better-sqlite3` (WAL mode, migrations)
- MQTT connector (connect, subscribe, publish, reconnection handling)
- zigbee2mqtt parser (bridge/devices, state messages, availability, bridge/event)
- Device Manager (CRUD, auto-discovery orchestration, state tracking)
- DataCategory inference from zigbee2mqtt expose definitions
- Typed internal event bus (EngineEvent discriminated union)
- REST API: device endpoints + health endpoint + raw expose endpoint
- WebSocket: broadcast all engine events to connected clients
- Structured logging (pino via Fastify)
- Shell test script for API verification

### Out of Scope (deferred)

- Equipments, Bindings, Computed Data (V0.2)
- Zones and aggregation (V0.3)
- Web UI (V0.4)
- Authentication / Authorization (later version)
- Tasmota / ESPHome parsers (V0.9)
- InfluxDB history (V0.6)
- Scenarios (V0.7)
- Docker / PM2 (V0.9)

## Edge Cases

- **MQTT broker unreachable at startup**: Engine should retry connection with backoff, log warnings, and start the API server anyway (health endpoint reports MQTT disconnected)
- **MQTT disconnects during operation**: Auto-reconnect with exponential backoff. On reconnect, re-subscribe to all topics. Emit `system.mqtt.disconnected` / `system.mqtt.connected` events.
- **zigbee2mqtt/bridge/devices not yet published**: Wait for the retained message. If not received within a timeout, log a warning but continue running.
- **Device with no exposes**: Create the Device record but with empty Data and Orders arrays.
- **Unknown expose property**: Assign `generic` DataCategory, log the unrecognized property.
- **Duplicate MQTT messages**: DeviceData update should be idempotent — only emit `device.data.updated` if the value actually changed.
- **JSON parse failure on MQTT payload**: Log error, skip message, do not crash.
- **Device removed from zigbee2mqtt**: When bridge/devices is re-read and a previously known device is missing, emit `device.removed` event and mark as offline. Do NOT delete from SQLite automatically (user decides via DELETE API).
- **Very large device list**: Should handle 200+ devices without performance issues.
- **SQLite database file does not exist**: Create it automatically with migrations.
- **Concurrent state updates**: better-sqlite3 is synchronous and single-threaded, no concurrency issues.
