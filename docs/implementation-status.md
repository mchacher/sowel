# Corbel — Implementation Status

> Updated: 2026-02-19 — V0.1 done, V0.2 in progress

## Roadmap Changes

1. **Incremental UI**: The original roadmap bundled all UI into V0.4. Changed to an **incremental approach**: each backend version ships its corresponding UI pages. V0.4 becomes a polish/UX milestone.
2. **Topology first**: V0.2 and V0.3 were swapped. Zones (spatial topology) are now implemented before Equipments, so users define where things are before assigning functional units.
3. **Core data model**: See [data-model.md](data-model.md) for the complete 3-layer architecture (Zones → Equipments → Devices).

## Versions

| Version | Feature | Status |
|---------|---------|--------|
| **V0.1** | MQTT + Devices + **UI Scaffolding & Devices page** | ✅ Done |
| **V0.2** | **Zones + Equipment Groups + UI Zones** (topology) | 🚧 In progress |
| V0.3 | Equipments + Bindings + Orders + **UI Equipments** | — |
| V0.4 | **UI Polish & Real-time UX** (reconnection, dark mode, responsive, animations) | — |
| V0.5 | Computed Data + Internal Rules | — |
| V0.6 | History (InfluxDB) + Zone Aggregation Engine | — |
| V0.7 | Scenario Engine | — |
| V0.8 | Recipes | — |
| V0.9 | Polish | — |
| V1.0+ | AI Assistant | — |

---

## V0.1 — MQTT + Devices + UI

**Objective**: Connect to zigbee2mqtt, auto-discover all Zigbee devices, track their state in real-time, persist in SQLite. Provide a web UI to browse devices.

### What it does

- Connects to an MQTT broker and subscribes to zigbee2mqtt topics
- Auto-discovers devices from `zigbee2mqtt/bridge/devices` (parses exposes)
- Creates DeviceData (readable properties) and DeviceOrders (writable properties) for each device
- Infers DataCategory from property names (occupancy→motion, temperature→temperature, brightness→light_brightness, etc.)
- Tracks device state in real-time via MQTT state messages
- Marks devices online when they send data
- Persists everything in SQLite (WAL mode)
- Broadcasts all events via WebSocket
- **Web UI**: React app with Devices list and detail pages

### UI (React)

| Feature | Detail |
|---------|--------|
| Tech stack | React 18 + Vite + Tailwind v4 + Zustand + React Router v6 |
| Design system | Inter + JetBrains Mono fonts, Corbel color palette, Lucide icons |
| Devices list | Sortable table (name, manufacturer, model, source, battery, LQI, last seen), filter by name |
| Device detail | Data table, Orders list, raw expose viewer, inline name editor |
| Layout | Collapsible sidebar, connection status indicator, mobile bottom nav |
| WebSocket | Auto-reconnect with exponential backoff, live updates for all device events |
| State hydration | Devices fetched from API on startup, MQTT status from `/api/v1/health` |

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
| **UI** | |
| App | `ui/src/App.tsx`, `ui/src/main.tsx` |
| Stores | `ui/src/store/useDevices.ts`, `ui/src/store/useWebSocket.ts` |
| Layout | `ui/src/components/layout/AppLayout.tsx`, `Sidebar.tsx`, `ConnectionStatus.tsx` |
| Devices | `ui/src/components/devices/DeviceList.tsx`, `DeviceDataTable.tsx`, `DeviceNameEditor.tsx` |
| Pages | `ui/src/pages/DevicesPage.tsx`, `ui/src/pages/DeviceDetailPage.tsx` |
| Helpers | `ui/src/api.ts`, `ui/src/lib/format.ts`, `ui/src/types.ts` |
| Config | `ui/vite.config.ts`, `ui/src/index.css` (Tailwind theme) |

### Tests

51 unit tests — `npm test`

### Quick Start

```bash
cp .env.example .env     # Edit MQTT_URL
npm install
npm run dev              # Start engine (port 3000)

# In another terminal — start UI (port 5173)
cd ui && npm install && npm run dev

# Open http://localhost:5173/devices
```
