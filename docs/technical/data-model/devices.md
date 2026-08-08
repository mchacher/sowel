# Devices

> **Layer 3 -- Physical**: hardware discovered from integration plugins, with their raw data and orders. Never directly manipulated by the end user.
>
> See also: [Equipments](equipments.md) for the user-facing layer that binds to devices.

## Device

Devices are auto-discovered by integration plugins. They are documented here for completeness; users do not create them manually.

### 1 Interface

```typescript
type DeviceSource =
  | "zigbee2mqtt"
  | "lora2mqtt"
  | "tasmota"
  | "esphome"
  | "shelly"
  | "custom_mqtt"
  | "panasonic_cc"
  | "mcz_maestro"
  | "netatmo_hc";

type DeviceStatus = "online" | "offline" | "unknown";

interface Device {
  id: string; // UUID v4 (Sowel-internal)
  integrationId: string; // Plugin id that owns this device (e.g. "zigbee2mqtt")
  sourceDeviceId: string; // Plugin-side stable id (e.g. friendly_name, serial)
  name: string; // User-editable display name
  manufacturer?: string;
  model?: string;
  ieeeAddress?: string; // Hardware address (Zigbee IEEE, MAC, etc.)
  zoneId: string | null; // Optional placement (used by integrations for context)
  source: DeviceSource;
  status: DeviceStatus;
  lastSeen: string | null; // ISO 8601
  rawExpose?: unknown; // Raw plugin-specific metadata
  createdAt: string;
  updatedAt: string;
}
```

The pair `(integrationId, sourceDeviceId)` is unique across all devices and is the natural key used by plugins on rediscovery.

### 2 DeviceData

```typescript
interface DeviceData {
  id: string;
  deviceId: string;
  key: string; // Plugin-side property name
  type: DataType;
  category: DataCategory; // Drives binding suggestions and aggregation
  value: unknown;
  unit?: string;
  lastUpdated: string | null;
}
```

### 3 DeviceOrder

```typescript
interface DeviceOrder {
  id: string;
  deviceId: string;
  key: string; // Plugin-side command name
  type: DataType;
  category?: OrderCategory; // Semantic category, drives equipment-level aliasing
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
  valueOn?: string | number | boolean; // Boolean orders: wire value for true (e.g. "ON")
  valueOff?: string | number | boolean; // Boolean orders: wire value for false (e.g. "OFF")
}
```

For boolean orders, `valueOn` / `valueOff` carry the wire representation the device actually accepts (e.g. Zigbee2MQTT binary exposes expect `"ON"`/`"OFF"`). When declared by the integration at discovery time, `EquipmentManager.executeOrder` maps boolean-ish values onto them before dispatching to the plugin; orders without them are dispatched untouched (migration `014_device_orders_value_on_off.sql`).

> **Note**: earlier versions exposed MQTT-specific fields (`mqttSetTopic`, `payloadKey`, `dispatch_config`) on `DeviceOrder`. These are no longer part of the runtime API. Migration `004_drop_dispatch_config.sql` deprecated them; the underlying SQLite columns remain (SQLite cannot drop columns without rebuilding the table) but are ignored. Order delivery is now fully delegated to the integration plugin via `IntegrationPlugin.executeOrder()`.

### 4 DataType / DataCategory / OrderCategory

```typescript
type DataType = "boolean" | "number" | "enum" | "text" | "json";

type DataCategory =
  | "motion"
  | "temperature"
  | "humidity"
  | "pressure"
  | "luminosity"
  | "contact_door"
  | "contact_window"
  | "light_state"
  | "light_brightness"
  | "light_color_temp"
  | "light_color"
  | "shutter_position"
  | "lock_state"
  | "battery"
  | "power"
  | "energy"
  | "voltage"
  | "current"
  | "water_leak"
  | "smoke"
  | "co2"
  | "voc"
  | "noise"
  | "rain"
  | "wind"
  | "action"
  | "gate_state"
  | "cover_state"
  | "runtime_daily"
  | "weather_condition"
  | "uv"
  | "solar_radiation"
  | "setpoint"
  | "temperature_outdoor"
  | "humidity_outdoor"
  | "media_volume"
  | "media_mute"
  | "media_input"
  | "appliance_state"
  | "pool_water_temperature"
  | "pool_temperature_setpoint"
  | "generic";

type OrderCategory =
  | "light_toggle"
  | "set_brightness"
  | "set_color_temp"
  | "set_color"
  | "shutter_move"
  | "set_shutter_position"
  | "toggle_power"
  | "set_setpoint"
  | "gate_trigger"
  | "valve_toggle"
  | "toggle_mute"
  | "set_input"
  | "pool_pump_toggle"
  | "pool_cover_move"
  | "pool_cover_position"
  | "set_pool_temperature_setpoint";
```

### 5 SQLite Schema

```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  mqtt_base_topic TEXT,        -- legacy, kept for migration compatibility
  mqtt_name TEXT,              -- legacy, kept for migration compatibility
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  ieee_address TEXT,
  zone_id TEXT,
  source TEXT NOT NULL DEFAULT 'zigbee2mqtt',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen DATETIME,
  raw_expose JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  integration_id TEXT NOT NULL DEFAULT '',
  source_device_id TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_devices_integration_source
  ON devices(integration_id, source_device_id);

CREATE TABLE device_data (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generic',
  unit TEXT,
  value TEXT,
  last_updated DATETIME,
  last_changed TEXT,
  enum_values JSON,
  UNIQUE(device_id, key)
);

CREATE TABLE device_orders (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT,
  min_value REAL,
  max_value REAL,
  enum_values JSON,
  unit TEXT,
  -- Legacy columns kept for backward compatibility (ignored at runtime):
  mqtt_set_topic TEXT,
  payload_key TEXT,
  dispatch_config JSON NOT NULL DEFAULT '{}',
  UNIQUE(device_id, key)
);
```

---
