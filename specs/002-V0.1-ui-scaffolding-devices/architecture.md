# Architecture: V0.1 UI Scaffolding + Devices Page

## Tech Stack

| Component  | Technology             | Version                         |
| ---------- | ---------------------- | ------------------------------- |
| Framework  | React                  | 18+                             |
| Build tool | Vite                   | 5+                              |
| Language   | TypeScript             | strict mode                     |
| Styling    | Tailwind CSS           | 3+                              |
| State      | Zustand                | 4+                              |
| Routing    | React Router           | 6+                              |
| Icons      | Lucide React           | latest                          |
| Fonts      | Inter + JetBrains Mono | via Google Fonts or @fontsource |

## Data Flow

```
App startup:
  1. React app mounts
  2. useDevices store calls GET /api/v1/devices → hydrates device list
  3. useWebSocket store connects to ws://host:port/ws
  4. WebSocket events dispatch to useDevices store (addDevice, updateStatus, updateData, removeDevice)

User navigates to /devices:
  → DevicesPage reads from useDevices store → renders DeviceList

User clicks a device:
  → React Router navigates to /devices/:id
  → DeviceDetailPage calls GET /api/v1/devices/:id for full details (data + orders + raw expose)
  → Live updates continue via WebSocket → store → re-render

User edits device name:
  → PUT /api/v1/devices/:id { name: "new name" }
  → On success, update local store
```

## Data Model (Frontend)

No new backend types. The UI reuses types from `src/shared/types.ts`:

- `Device` — device metadata
- `DeviceData` — data points with current values
- `DeviceOrder` — available orders
- `DeviceWithDetails` — device + data + orders (API response for detail page)
- `EngineEvent` — WebSocket event discriminated union

These types will be imported or duplicated in the UI project. Strategy: create a `ui/src/types.ts` that mirrors the backend types needed by the frontend.

## Event Bus Events Consumed (via WebSocket)

| Event                      | UI Action                           |
| -------------------------- | ----------------------------------- |
| `device.discovered`        | Add device to store                 |
| `device.removed`           | Remove device from store            |
| `device.status_changed`    | Update device status in store       |
| `device.data.updated`      | Update specific data value in store |
| `system.mqtt.connected`    | Update connection indicator         |
| `system.mqtt.disconnected` | Update connection indicator         |

## API Endpoints Consumed

| Method | Endpoint                  | Usage                                    |
| ------ | ------------------------- | ---------------------------------------- |
| GET    | `/api/v1/devices`         | Hydrate device list on startup           |
| GET    | `/api/v1/devices/:id`     | Fetch full device detail (data + orders) |
| PUT    | `/api/v1/devices/:id`     | Update device name                       |
| GET    | `/api/v1/devices/:id/raw` | Fetch raw z2m expose data                |
| GET    | `/api/v1/health`          | Check backend is alive (optional)        |

## File Structure

```
ui/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── index.html
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.tsx                    # ReactDOM.createRoot + RouterProvider
    ├── App.tsx                     # Routes definition + AppLayout
    ├── index.css                   # Tailwind directives (@tailwind base/components/utilities) + font imports
    ├── types.ts                    # Frontend copy of shared types (Device, DeviceData, DeviceOrder, EngineEvent)
    ├── api.ts                      # Fetch helpers (getDevices, getDevice, updateDevice)
    ├── store/
    │   ├── useDevices.ts           # Zustand: device list, indexed by id
    │   └── useWebSocket.ts         # Zustand: WS connection, status, dispatch to other stores
    ├── components/
    │   ├── layout/
    │   │   ├── AppLayout.tsx       # Shell: sidebar + header + <Outlet/>
    │   │   ├── Sidebar.tsx         # Navigation links (Devices active, others placeholder)
    │   │   └── ConnectionStatus.tsx # WS/MQTT connection indicator in header
    │   └── devices/
    │       ├── DeviceList.tsx       # Grid/table of DeviceCard
    │       ├── DeviceCard.tsx       # Summary card: name, status badge, source, key data
    │       ├── DeviceDataTable.tsx  # Table of all DeviceData for a device
    │       └── DeviceNameEditor.tsx # Click-to-edit for device name
    └── pages/
        ├── DevicesPage.tsx          # Route: /devices — uses DeviceList
        └── DeviceDetailPage.tsx     # Route: /devices/:id — full detail view
```

## Zustand Stores

### useDevices

```typescript
interface DevicesState {
  devices: Map<string, Device>; // indexed by id
  deviceData: Map<string, DeviceData[]>; // indexed by deviceId
  loading: boolean;
  error: string | null;

  // Actions
  fetchDevices: () => Promise<void>;
  addDevice: (device: Device) => void;
  removeDevice: (deviceId: string) => void;
  updateDeviceStatus: (deviceId: string, status: DeviceStatus) => void;
  updateDeviceData: (deviceId: string, key: string, value: unknown, timestamp: string) => void;
  updateDeviceName: (deviceId: string, name: string) => Promise<void>;
}
```

### useWebSocket

```typescript
interface WebSocketState {
  status: "connecting" | "connected" | "disconnected";
  mqttConnected: boolean;

  // Actions
  connect: () => void;
  disconnect: () => void;
}
```

The WebSocket store internally dispatches events to useDevices:

- On `device.discovered` → `useDevices.getState().addDevice(event.device)`
- On `device.data.updated` → `useDevices.getState().updateDeviceData(...)`
- etc.

## Vite Configuration

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
```

This allows the UI dev server (port 5173) to proxy API and WS calls to the backend (port 3000).

## UI Components Detail

### AppLayout

- Left sidebar (collapsible on mobile) with navigation links
- Top header bar with app name "Winch" and connection status indicator
- Main content area with `<Outlet/>` for routed pages

### DeviceCard

- Displays: device name, source badge (zigbee2mqtt/tasmota), status dot (green/red/gray)
- Shows 1-2 key data values (e.g., temperature, state)
- Last seen as relative time ("2 min ago")
- Clickable → navigates to /devices/:id

### DeviceDetailPage

- Header: device name (editable) + status badge + source + model/manufacturer
- Section "Data": table of all DeviceData (key, category, value, unit, last updated)
- Section "Orders": list of available DeviceOrders (key, type, range/enum)
- Section "Raw": collapsible JSON viewer for rawExpose
- Back button → /devices

### ConnectionStatus

- Small indicator in the header
- Green dot + "Connected" when WS is connected AND MQTT is connected
- Orange dot + "WS connected, MQTT disconnected"
- Red dot + "Disconnected" when WS is disconnected
