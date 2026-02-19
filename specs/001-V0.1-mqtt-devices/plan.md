# Implementation Plan: V0.1 MQTT + Devices

## Tasks

### Phase 1: Project Setup
1. [ ] Initialize Node.js project (package.json with dependencies)
2. [ ] Create tsconfig.json (strict mode)
3. [ ] Create .env.example and .gitignore
4. [ ] Create folder structure (src/, migrations/, scripts/)

### Phase 2: Types & Constants
5. [ ] Define all V0.1 types in `src/shared/types.ts` (Device, DeviceData, DeviceOrder, DataType, DataCategory, DeviceSource, DeviceStatus, EngineEvent)
6. [ ] Define category inference maps in `src/shared/constants.ts`

### Phase 3: Core Modules
7. [ ] Implement `src/config.ts` (env config loading with validation)
8. [ ] Implement `src/core/logger.ts` (pino logger factory)
9. [ ] Implement `src/core/event-bus.ts` (typed EventEmitter)
10. [ ] Implement `src/core/database.ts` (SQLite connection + migration runner)
11. [ ] Create `migrations/001_devices.sql` (devices, device_data, device_orders tables)

### Phase 4: MQTT + Device Layer
12. [ ] Implement `src/mqtt/mqtt-connector.ts` (connect, subscribe, publish, reconnection)
13. [ ] Implement `src/devices/category-inference.ts` (DataCategory from expose property names)
14. [ ] Implement `src/mqtt/parsers/zigbee2mqtt.ts` (parse bridge/devices, state messages, availability, bridge/event)
15. [ ] Implement `src/devices/device-manager.ts` (CRUD, auto-discovery from parser, state updates, event emission)

### Phase 5: API Layer
16. [ ] Implement `src/api/server.ts` (Fastify setup, CORS, plugin registration)
17. [ ] Implement `src/api/routes/health.ts` (GET /api/v1/health)
18. [ ] Implement `src/api/routes/devices.ts` (CRUD + raw expose endpoint)
19. [ ] Implement `src/api/websocket.ts` (broadcast engine events)

### Phase 6: Entry Point & Helpers
20. [ ] Implement `src/index.ts` (bootstrap sequence)
21. [ ] Create `scripts/test-api.sh` (curl-based API test script)

### Phase 7: Verify
22. [ ] TypeScript compiles with zero errors (`npx tsc --noEmit`)
23. [ ] Run tests (`npm test`)
24. [ ] Manual test: connect to real zigbee2mqtt at 192.168.0.45, verify devices discovered

## Dependencies

- No prior version required (this is the foundation)
- Requires an MQTT broker with zigbee2mqtt running (user has one at 192.168.0.45)

## Testing

### Automated
- Unit tests for category inference
- Unit tests for zigbee2mqtt expose parser
- Integration tests for Device Manager CRUD

### Manual Verification
1. Start engine with `npm run dev`
2. Check logs: MQTT connected, devices discovered summary
3. `curl http://localhost:3000/api/v1/health` — check MQTT status and device count
4. `curl http://localhost:3000/api/v1/devices` — verify all zigbee2mqtt devices appear
5. `curl http://localhost:3000/api/v1/devices/<id>` — check Data and Orders for a known device
6. `wscat -c ws://localhost:3000/ws` — trigger a sensor, see `device.data.updated` event
7. Run `scripts/test-api.sh` for a full API walkthrough
