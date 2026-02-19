// ============================================================
// Data Types (mirrors src/shared/types.ts)
// ============================================================

export type DataType = "boolean" | "number" | "enum" | "text" | "json";

export type DataCategory =
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
  | "generic";

// ============================================================
// Device
// ============================================================

export type DeviceSource =
  | "zigbee2mqtt"
  | "tasmota"
  | "esphome"
  | "shelly"
  | "custom_mqtt";

export type DeviceStatus = "online" | "offline" | "unknown";

export interface Device {
  id: string;
  mqttBaseTopic: string;
  mqttName: string;
  name: string;
  manufacturer?: string;
  model?: string;
  ieeeAddress?: string;
  zoneId: string | null;
  source: DeviceSource;
  status: DeviceStatus;
  lastSeen: string | null;
  rawExpose?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceData {
  id: string;
  deviceId: string;
  key: string;
  type: DataType;
  category: DataCategory;
  value: unknown;
  unit?: string;
  lastUpdated: string | null;
}

export interface DeviceOrder {
  id: string;
  deviceId: string;
  key: string;
  type: DataType;
  mqttSetTopic: string;
  payloadKey: string;
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}

export interface DeviceWithDetails extends Device {
  data: DeviceData[];
  orders: DeviceOrder[];
}

// ============================================================
// Zone
// ============================================================

export interface Zone {
  id: string;
  name: string;
  parentId: string | null;
  icon?: string;
  description?: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ZoneWithChildren extends Zone {
  children: ZoneWithChildren[];
  groups: EquipmentGroup[];
}

// ============================================================
// Equipment Group
// ============================================================

export interface EquipmentGroup {
  id: string;
  name: string;
  zoneId: string;
  icon?: string;
  description?: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Engine Events (received via WebSocket)
// ============================================================

export type EngineEvent =
  | { type: "device.discovered"; device: Device }
  | { type: "device.removed"; deviceId: string; deviceName: string }
  | {
      type: "device.status_changed";
      deviceId: string;
      deviceName: string;
      status: DeviceStatus;
    }
  | {
      type: "device.data.updated";
      deviceId: string;
      deviceName: string;
      dataId: string;
      key: string;
      value: unknown;
      previous: unknown;
      timestamp: string;
    }
  | { type: "zone.created"; zone: Zone }
  | { type: "zone.updated"; zone: Zone }
  | { type: "zone.removed"; zoneId: string; zoneName: string }
  | { type: "group.created"; group: EquipmentGroup }
  | { type: "group.updated"; group: EquipmentGroup }
  | { type: "group.removed"; groupId: string; groupName: string }
  | { type: "system.started" }
  | { type: "system.mqtt.connected" }
  | { type: "system.mqtt.disconnected" }
  | { type: "system.error"; error: string }
  | { type: "connected"; message: string; version: string };
