# Corbel — Implementation Status

> Updated: 2026-02-20 — V0.1 through V0.8 done

## Roadmap Changes

1. **Incremental UI**: Each backend version ships its corresponding UI pages (not bundled in a single V0.4).
2. **Topology first**: Zones implemented before Equipments, so users define spatial structure first.
3. **Equipment Groups removed**: Replaced by automatic UI-level grouping by equipment type (Lights, Shutters, Sensors, Switches) in the Home view. No backend entity — purely a UI display pattern.
4. **Core data model**: See [data-model.md](data-model.md) for the complete 3-layer architecture (Zones → Equipments → Devices).

## Versions

| Version | Feature | Status |
|---------|---------|--------|
| **V0.1** | MQTT + Devices + UI Scaffolding & Devices page | ✅ Done |
| **V0.2** | Zones + UI Zones (topology) | ✅ Done |
| **V0.3** | Equipments + Bindings + Orders + UI Equipments | ✅ Done |
| **V0.4** | UI Restructuring (Home view, zone navigation) | ✅ Done |
| **V0.5** | Sensor Equipment Support (adaptive UI) | ✅ Done |
| **V0.6** | Zone Aggregation Engine (real-time status) | ✅ Done |
| **V0.7** | Shutter Equipment Support (controls + aggregation) | ✅ Done |
| **V0.8** | Recipe Engine + Motion-Light Recipe | ✅ Done |
| V0.9 | Scenario Engine | — |
| V0.10 | Computed Data | — |
| V0.11 | History (InfluxDB) | — |
| V0.12 | Polish | — |
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

51 unit tests (V0.1 scope)

---

## V0.2 — Zones + UI

**Objective**: Define the spatial topology of the home — hierarchical zones.

### What it does

- Zone CRUD with hierarchical nesting (Home → Floor → Room)
- Circular reference detection for zone hierarchy
- Delete guards (no children, no equipments)
- Zone tree API endpoint
- **Web UI**: Zone tree view, zone detail page

### Tests

23 unit tests for ZoneManager

---

## V0.3 — Equipments + Bindings + Orders + UI

**Objective**: Introduce the Equipment entity — the user-facing functional unit. Bind to Devices via DataBindings (read) and OrderBindings (write). Execute orders via MQTT. Focused on lighting (On/Off + Dimmers).

### What it does

- Equipment CRUD (name, type, zone, enabled)
- 14 equipment types defined in backend, 8 exposed in UI (light_onoff, light_dimmable, light_color, shutter, switch, sensor, motion_sensor, contact_sensor)
- DataBinding: maps DeviceData to Equipment alias (state, brightness...)
- OrderBinding: maps DeviceOrder to Equipment command (state, brightness...)
- Multi-device dispatch: same alias → multiple DeviceOrders → parallel MQTT publish
- Reactive pipeline: `device.data.updated` → lookup bindings → `equipment.data.changed`
- Order execution: `POST /equipments/:id/orders/:alias` → resolve bindings → MQTT publish
- Zone delete guard extended: zones with equipments cannot be deleted
- WebSocket broadcasts all equipment events
- **Web UI**: Equipment list page (grouped by zone), equipment detail page, create wizard with device selector, light toggle + brightness slider

### UI Components

| Component | Purpose |
|-----------|---------|
| EquipmentsPage | List all equipments grouped by zone, quick controls |
| EquipmentDetailPage | Full detail with bindings, controls, edit/delete |
| EquipmentForm | Create/edit modal with 2-step wizard (info → device selection) |
| DeviceSelector | Filtered device picker (by DataCategory per EquipmentType) |
| EquipmentCard | Card with type icon, state, quick toggle + shutter controls |
| LightControl | On/off toggle + brightness slider for lights/dimmers |

### API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/equipments` | List all with bindings + data |
| GET | `/api/v1/equipments/:id` | Detail with bindings + data |
| POST | `/api/v1/equipments` | Create equipment |
| PUT | `/api/v1/equipments/:id` | Update equipment |
| DELETE | `/api/v1/equipments/:id` | Delete equipment (cascades bindings) |
| POST | `/api/v1/equipments/:id/orders/:alias` | Execute order |
| POST | `/api/v1/equipments/:id/data-bindings` | Add DataBinding |
| DELETE | `/api/v1/equipments/:id/data-bindings/:bindingId` | Remove DataBinding |
| POST | `/api/v1/equipments/:id/order-bindings` | Add OrderBinding |
| DELETE | `/api/v1/equipments/:id/order-bindings/:bindingId` | Remove OrderBinding |

### Event Bus Events

| Event | When |
|-------|------|
| `equipment.created` | Equipment created |
| `equipment.updated` | Equipment updated |
| `equipment.removed` | Equipment deleted |
| `equipment.data.changed` | Bound DeviceData value changed |
| `equipment.order.executed` | Order dispatched to MQTT |

### Tests

38 unit tests — Equipment CRUD, bindings, order execution, reactive pipeline, zone delete guard

---

## V0.4 — UI Restructuring

**Objective**: Reorganize the UI around a zone-centric daily view (Home) vs. a settings area.

### What it does

- Sidebar reorganized into two sections:
  - **Home**: primary daily-use view with zone treeview navigation
  - **Settings**: Devices, Equipments, Zones pages (configuration, rarely accessed)
- Home page shows zone hierarchy (Home > Floor > Room)
- Clicking a zone displays its equipments grouped by type
- Equipment groups are UI-only display patterns (automatic by EquipmentType: Lights, Shutters, Sensors, Switches)
- CompactEquipmentCard with inline controls for lights
- SidebarZoneTree component for zone navigation

### UI Components

| Component | Purpose |
|-----------|---------|
| HomePage | Zone-centric daily dashboard |
| SidebarZoneTree | Zone treeview in sidebar |
| ZoneEquipmentsView | Equipment list within a zone, grouped by type |
| CompactEquipmentCard | Compact card with inline quick controls |

---

## V0.5 — Sensor Equipment Support

**Objective**: Full support for sensor-type equipments with auto-adaptive UI.

### What it does

- Sensor types fully supported: `sensor`, `motion_sensor`, `contact_sensor`
- Auto-adaptive sensor UI: icon, color, and value display based on DataCategory
- Multi-value sensor display (e.g. temperature + humidity on same card)
- Battery level indicator with color-coded icon
- Boolean sensor formatting (motion: Mouvement/Calme, contact: Ouverte/Fermée)
- SensorDataPanel for equipment detail page

### UI Components

| Component | Purpose |
|-----------|---------|
| SensorDataPanel | Full sensor data display for detail page |
| sensorUtils.tsx | Shared utilities: getSensorIcon, getSensorIconColor, getSensorBindings, getBatteryBinding, formatSensorValue, etc. |

---

## V0.6 — Zone Aggregation Engine

**Objective**: Automatic real-time zone status aggregation from equipment data.

### What it does

- Bottom-up aggregation engine: processes leaf zones first, then walks up parent chain
- 15 aggregated fields in `ZoneAggregatedData`:
  - `temperature`, `humidity`, `luminosity` (AVG)
  - `motion` (OR), `motionSensors` (COUNT), `motionSince` (timestamp)
  - `lightsOn`, `lightsTotal` (COUNT)
  - `shuttersOpen`, `shuttersTotal` (COUNT), `averageShutterPosition` (AVG)
  - `openDoors`, `openWindows` (COUNT)
  - `waterLeak`, `smoke` (OR)
- Three-level cache (directCache, mergedCache, publicCache) with incremental updates
- Recursive: parent Zone merges its own data + all child Zone accumulators
- Event-driven: recomputes on `equipment.data.changed`, zone CRUD, `system.started`
- Zustand store: `useZoneAggregation` for reactive UI updates

### UI Components

| Component | Purpose |
|-----------|---------|
| ZoneAggregationHeader | Status pills: temperature, humidity, luminosity, motion+duration, lights count, shutter count+position, door/window alerts, water/smoke alerts |

### Files

| Module | Files |
|--------|-------|
| Backend | `src/zones/zone-aggregator.ts` |
| API | Zone aggregation endpoint in `src/api/routes/zones.ts` |
| UI Store | `ui/src/store/useZoneAggregation.ts` |
| UI Component | `ui/src/components/home/ZoneAggregationHeader.tsx` |
| Tests | `src/zones/zone-aggregator.test.ts` (25 tests) |

---

## V0.7 — Shutter Equipment Support

**Objective**: Full shutter/cover control with zone aggregation.

### What it does

- Shutter controls: Open / Stop / Close buttons + position display
- Position labels: "Fermé" (0%), "Ouvert" (100%), numeric % for intermediate values
- ShutterControl component for equipment detail page
- Inline shutter controls in EquipmentCard (equipment list) and CompactEquipmentCard (home view)
- Zone aggregation: `shuttersOpen` / `shuttersTotal` / `averageShutterPosition`
- Shutter pill in ZoneAggregationHeader
- 8 supported equipment types in creation form (light_onoff, light_dimmable, light_color, shutter, switch, sensor, motion_sensor, contact_sensor)

### UI Components

| Component | Purpose |
|-----------|---------|
| ShutterControl | Full Open/Stop/Close buttons + position bar for detail page |
| EquipmentCard | Updated with inline shutter controls |
| CompactEquipmentCard | Updated with inline shutter controls |
| ZoneAggregationHeader | Added shutter aggregation pill |

---

## V0.8 — Recipe Engine + Motion-Light Recipe

**Objective**: Introduce a code-driven Recipe engine for pre-built behavior patterns with user-supplied parameters. First recipe: motion-light (auto-light on motion detection).

### What it does

- Abstract `Recipe` base class with lifecycle (`validate` / `start` / `stop`)
- `RecipeManager` manages recipe registration, instance creation/deletion, DB persistence, execution logging
- `RecipeStateStore` provides key-value persistence per instance (SQLite)
- `RecipeContext` injected into recipes: eventBus, equipmentManager, zoneAggregator, logger, stateStore, log
- Recipe instances restored on engine restart (all enabled instances re-started)
- Execution log per instance (structured messages stored in SQLite)
- EventBus enhanced with unsubscribe support (on/onType return cleanup functions)
- **motion-light** recipe: auto-light on motion + timeout extinction + manual override support

### Motion-Light Recipe Logic

- Motion detected + light OFF → turn ON
- Motion detected + light ON → reset timer
- Motion stops + light ON → start extinction timer
- Timer expires → turn OFF
- Light turned ON externally (manual) → start timer if no motion
- Light turned OFF externally → cancel timer

### API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/recipes` | List available recipe definitions |
| GET | `/api/v1/recipes/:recipeId` | Get recipe definition with slots |
| GET | `/api/v1/recipe-instances` | List all active instances |
| POST | `/api/v1/recipe-instances` | Create instance `{ recipeId, params }` |
| DELETE | `/api/v1/recipe-instances/:id` | Stop and delete instance |
| GET | `/api/v1/recipe-instances/:id/log` | Get execution log (`?limit=50`) |

### Event Bus Events

| Event | When |
|-------|------|
| `recipe.instance.created` | Instance created |
| `recipe.instance.started` | Instance started |
| `recipe.instance.stopped` | Instance stopped |
| `recipe.instance.removed` | Instance deleted |
| `recipe.instance.error` | Instance error |

### Files

| Module | Files |
|--------|-------|
| Types | `src/shared/types.ts` (RecipeSlotDef, RecipeInfo, RecipeInstance, RecipeLogEntry, recipe events) |
| DB | `migrations/005_recipes.sql` |
| Core | `src/core/event-bus.ts` (unsubscribe support) |
| Recipes | `src/recipes/recipe.ts`, `recipe-manager.ts`, `recipe-state-store.ts`, `motion-light.ts` |
| API | `src/api/routes/recipes.ts` |
| Integration | `src/api/server.ts`, `src/index.ts` |
| Tests | `src/recipes/recipe-manager.test.ts` (9), `src/recipes/motion-light.test.ts` (12) |

---

## Test Summary

| Module | File | Tests |
|--------|------|-------|
| Event Bus | `src/core/event-bus.test.ts` | 5 |
| Category Inference | `src/devices/category-inference.test.ts` | 24 |
| Device Manager | `src/devices/device-manager.test.ts` | 24 |
| Zone Manager | `src/zones/zone-manager.test.ts` | 23 |
| Zone Aggregator | `src/zones/zone-aggregator.test.ts` | 25 |
| Equipment Manager | `src/equipments/equipment-manager.test.ts` | 38 |
| Recipe Manager | `src/recipes/recipe-manager.test.ts` | 9 |
| Motion-Light Recipe | `src/recipes/motion-light.test.ts` | 12 |
| **Total** | **8 test files** | **160 tests** |

---

## Quick Start

```bash
cp .env.example .env     # Edit MQTT_URL
npm install
npm run dev              # Start engine (port 3000)

# In another terminal — start UI (port 5173)
cd ui && npm install && npm run dev

# Open http://localhost:5173
```
