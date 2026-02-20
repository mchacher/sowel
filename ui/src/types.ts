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
}

export interface ZoneAggregatedData {
  temperature: number | null;
  humidity: number | null;
  luminosity: number | null;
  motion: boolean;
  motionSensors: number;
  motionSince: string | null;
  openDoors: number;
  openWindows: number;
  waterLeak: boolean;
  smoke: boolean;
  lightsOn: number;
  lightsTotal: number;
  shuttersOpen: number;
  shuttersTotal: number;
  averageShutterPosition: number | null;
}

// ============================================================
// Equipment
// ============================================================

export type EquipmentType =
  | "light_onoff"
  | "light_dimmable"
  | "light_color"
  | "shutter"
  | "thermostat"
  | "lock"
  | "alarm"
  | "sensor"
  | "motion_sensor"
  | "contact_sensor"
  | "media_player"
  | "camera"
  | "switch"
  | "generic";

export interface Equipment {
  id: string;
  name: string;
  zoneId: string;
  type: EquipmentType;
  icon?: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DataBinding {
  id: string;
  equipmentId: string;
  deviceDataId: string;
  alias: string;
}

export interface OrderBinding {
  id: string;
  equipmentId: string;
  deviceOrderId: string;
  alias: string;
}

export interface DataBindingWithValue extends DataBinding {
  deviceId: string;
  deviceName: string;
  key: string;
  type: DataType;
  category: DataCategory;
  value: unknown;
  unit?: string;
  lastUpdated: string | null;
}

export interface OrderBindingWithDetails extends OrderBinding {
  deviceId: string;
  deviceName: string;
  key: string;
  type: DataType;
  mqttSetTopic: string;
  payloadKey: string;
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}

export interface EquipmentWithDetails extends Equipment {
  dataBindings: DataBindingWithValue[];
  orderBindings: OrderBindingWithDetails[];
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
  | { type: "zone.data.changed"; zoneId: string; aggregatedData: ZoneAggregatedData }
  | { type: "equipment.created"; equipment: Equipment }
  | { type: "equipment.updated"; equipment: Equipment }
  | { type: "equipment.removed"; equipmentId: string; equipmentName: string }
  | {
      type: "equipment.data.changed";
      equipmentId: string;
      alias: string;
      value: unknown;
      previous: unknown;
    }
  | {
      type: "equipment.order.executed";
      equipmentId: string;
      orderAlias: string;
      value: unknown;
    }
  | { type: "system.started" }
  | { type: "system.mqtt.connected" }
  | { type: "system.mqtt.disconnected" }
  | { type: "system.error"; error: string }
  | { type: "connected"; message: string; version: string };
