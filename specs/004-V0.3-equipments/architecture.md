# Architecture: V0.3 Equipments + Bindings + Orders

## Data Model Changes

### New types in `src/shared/types.ts`

```typescript
type EquipmentType =
  | "light" | "dimmer" | "color_light"
  | "shutter" | "thermostat" | "lock" | "alarm"
  | "sensor" | "motion_sensor" | "contact_sensor"
  | "media_player" | "camera" | "switch" | "generic";

interface Equipment {
  id: string;
  name: string;
  zoneId: string;
  groupId: string | null;
  type: EquipmentType;
  icon?: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DataBinding {
  id: string;
  equipmentId: string;
  deviceDataId: string;
  alias: string;
}

interface OrderBinding {
  id: string;
  equipmentId: string;
  deviceOrderId: string;
  alias: string;
}

// API response: Equipment with resolved bindings and current data
interface EquipmentWithDetails extends Equipment {
  dataBindings: DataBindingWithValue[];
  orderBindings: OrderBindingWithDetails[];
}

interface DataBindingWithValue extends DataBinding {
  deviceId: string;
  deviceName: string;
  key: string;          // DeviceData key
  type: DataType;
  category: DataCategory;
  value: unknown;
  unit?: string;
  lastUpdated: string | null;
}

interface OrderBindingWithDetails extends OrderBinding {
  deviceId: string;
  deviceName: string;
  key: string;          // DeviceOrder key
  type: DataType;
  mqttSetTopic: string;
  payloadKey: string;
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}
```

### New EngineEvent variants

```typescript
| { type: "equipment.created"; equipment: Equipment }
| { type: "equipment.updated"; equipment: Equipment }
| { type: "equipment.removed"; equipmentId: string; equipmentName: string }
| { type: "equipment.data.changed"; equipmentId: string; alias: string; value: unknown; previous: unknown }
| { type: "equipment.order.executed"; equipmentId: string; orderAlias: string; value: unknown }
```

### New SQLite tables (migration `003_equipments.sql`)

```sql
CREATE TABLE IF NOT EXISTS equipments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES equipment_groups(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'generic',
  icon TEXT,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS data_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_data_id TEXT NOT NULL REFERENCES device_data(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias)
);

CREATE TABLE IF NOT EXISTS order_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_order_id TEXT NOT NULL REFERENCES device_orders(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias, device_order_id)
);
```

## Event Bus Events

### Emitted by EquipmentManager

| Event | When |
|---|---|
| `equipment.created` | Equipment created via API |
| `equipment.updated` | Equipment updated via API |
| `equipment.removed` | Equipment deleted via API |
| `equipment.data.changed` | Bound DeviceData value changed (reactive pipeline) |
| `equipment.order.executed` | Order dispatched to MQTT |

### Consumed by EquipmentManager

| Event | Action |
|---|---|
| `device.data.updated` | Look up DataBindings for the changed DeviceData, emit `equipment.data.changed` for each affected Equipment |

## Reactive Data Flow

```
MQTT message → DeviceManager.updateDeviceData()
  → EventBus: "device.data.updated" { deviceId, dataId, key, value, previous }
    → EquipmentManager.handleDeviceDataUpdated()
      → Query: SELECT * FROM data_bindings WHERE device_data_id = ?
      → For each affected binding:
        → Emit: "equipment.data.changed" { equipmentId, alias, value, previous }
          → WebSocket broadcasts to UI clients
```

## API Changes

### Equipment endpoints

| Method | Route | Description |
|---|---|---|
| GET | `/api/v1/equipments` | List all equipments (with bindings + current data) |
| GET | `/api/v1/equipments/:id` | Get equipment with bindings + current data |
| POST | `/api/v1/equipments` | Create equipment |
| PUT | `/api/v1/equipments/:id` | Update equipment |
| DELETE | `/api/v1/equipments/:id` | Delete equipment (cascades bindings) |
| POST | `/api/v1/equipments/:id/orders/:alias` | Execute equipment order |

### Binding management (nested under equipment)

| Method | Route | Description |
|---|---|---|
| POST | `/api/v1/equipments/:id/data-bindings` | Add a DataBinding |
| DELETE | `/api/v1/equipments/:id/data-bindings/:bindingId` | Remove a DataBinding |
| POST | `/api/v1/equipments/:id/order-bindings` | Add an OrderBinding |
| DELETE | `/api/v1/equipments/:id/order-bindings/:bindingId` | Remove an OrderBinding |

### Request/Response schemas

**POST /api/v1/equipments**
```json
{
  "name": "Spots Salon",
  "type": "dimmer",
  "zoneId": "uuid-salon",
  "groupId": "uuid-eclairage-ambiance",
  "description": "Spots encastrés plafond"
}
```

**POST /api/v1/equipments/:id/data-bindings**
```json
{
  "deviceDataId": "uuid-device-data-state",
  "alias": "state"
}
```

**POST /api/v1/equipments/:id/order-bindings**
```json
{
  "deviceOrderId": "uuid-device-order-state",
  "alias": "turn_on"
}
```

**POST /api/v1/equipments/:id/orders/:alias**
```json
{
  "value": true
}
```

## Smart Device Filtering

The UI uses a mapping from EquipmentType to required DataCategories to filter compatible devices.

```typescript
const EQUIPMENT_TYPE_CATEGORIES: Record<EquipmentType, DataCategory[]> = {
  light:          ["light_state"],
  dimmer:         ["light_state", "light_brightness"],
  color_light:    ["light_state", "light_brightness", "light_color"],
  shutter:        ["shutter_position"],
  thermostat:     ["temperature"],
  sensor:         ["temperature", "humidity", "pressure", "luminosity", "co2", "voc"],
  motion_sensor:  ["motion"],
  contact_sensor: ["contact_door", "contact_window"],
  lock:           ["lock_state"],
  switch:         ["light_state"],  // switches use same state category
  generic:        [],                // no filter, show all
  // ...
};
```

**Filter logic**: A device is compatible if it has at least ONE DeviceData matching ANY of the required categories. The UI fetches devices with data and filters client-side.

## Simple Multi-Device Aggregation

When an Equipment has multiple DataBindings with the same alias from different devices, the EquipmentManager computes an aggregated value:

| Data type | Aggregation |
|---|---|
| boolean | OR — any `true` → Equipment value is `true` |
| number | AVG — average of all bound values |

This aggregation happens in `EquipmentManager.getEquipmentData()` and in the reactive handler.

For V0.3, this is a simple in-memory computation. The full expression engine (V0.5) will replace this.

## UI Changes

### New pages

| Page | Route | Content |
|---|---|---|
| EquipmentsPage | `/equipments` | List all equipments, grouped by zone. Quick controls (toggle, slider). |
| EquipmentDetailPage | `/equipments/:id` | Full detail: bindings, data values, order execution. Edit/delete. |

### New components

| Component | Purpose |
|---|---|
| `EquipmentList` | List of equipments with status and quick controls |
| `EquipmentCard` | Individual equipment with icon, name, state, quick toggle |
| `EquipmentForm` | Modal: create/edit equipment (name, type, zone, group, description) |
| `BindingWizard` | Step in create flow: select devices, auto-create bindings |
| `DeviceSelector` | List compatible devices (filtered by DataCategory), select one or more |
| `LightControl` | Toggle + brightness slider for light/dimmer types |

### Store changes

| Store | Changes |
|---|---|
| `useEquipments` | New Zustand store: equipments CRUD, order execution, data updates |
| `useWebSocket` | Add handlers for equipment.* events |

## File Changes

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add Equipment, EquipmentType, DataBinding, OrderBinding, EquipmentWithDetails, DataBindingWithValue, OrderBindingWithDetails, new EngineEvent variants |
| `migrations/003_equipments.sql` | New migration: equipments, data_bindings, order_bindings tables |
| `src/equipments/equipment-manager.ts` | **NEW** — Equipment CRUD, binding management, reactive pipeline handler, order execution |
| `src/api/routes/equipments.ts` | **NEW** — REST endpoints for equipments, bindings, orders |
| `src/api/server.ts` | Register equipment routes, add EquipmentManager to deps |
| `src/api/websocket.ts` | Broadcast equipment.* events |
| `src/index.ts` | Instantiate EquipmentManager, wire to EventBus |
| `src/zones/zone-manager.ts` | Extend delete guard: check for equipments in zone |
| `ui/src/types.ts` | Mirror backend types |
| `ui/src/api.ts` | Add equipment API functions |
| `ui/src/store/useEquipments.ts` | **NEW** — Zustand store |
| `ui/src/store/useWebSocket.ts` | Handle equipment events |
| `ui/src/pages/EquipmentsPage.tsx` | **NEW** — Equipment list page |
| `ui/src/pages/EquipmentDetailPage.tsx` | **NEW** — Equipment detail page |
| `ui/src/components/equipments/EquipmentForm.tsx` | **NEW** — Create/edit modal |
| `ui/src/components/equipments/DeviceSelector.tsx` | **NEW** — Filtered device picker |
| `ui/src/components/equipments/LightControl.tsx` | **NEW** — Toggle + brightness slider |
| `ui/src/components/equipments/EquipmentCard.tsx` | **NEW** — Equipment card with quick controls |
| `ui/src/App.tsx` | Add /equipments routes |
| `ui/src/components/layout/Sidebar.tsx` | Enable Equipments nav item |
