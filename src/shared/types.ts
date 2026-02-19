// ============================================================
// Data Types
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

// ============================================================
// Device with relations (API response)
// ============================================================

export interface DeviceWithDetails extends Device {
  data: DeviceData[];
  orders: DeviceOrder[];
}

// ============================================================
// Event Bus
// ============================================================

export type EngineEvent =
  // Device events
  | {
      type: "device.discovered";
      device: Device;
    }
  | {
      type: "device.removed";
      deviceId: string;
      deviceName: string;
    }
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
  // System events
  | { type: "system.started" }
  | { type: "system.mqtt.connected" }
  | { type: "system.mqtt.disconnected" }
  | { type: "system.error"; error: string };

// ============================================================
// zigbee2mqtt types (parser internal)
// ============================================================

export interface Z2MDevice {
  ieee_address: string;
  friendly_name: string;
  type: "Coordinator" | "Router" | "EndDevice";
  definition?: {
    model: string;
    vendor: string;
    description: string;
    exposes: Z2MExpose[];
  };
  manufacturer?: string;
  model_id?: string;
  supported: boolean;
  disabled: boolean;
}

export interface Z2MExpose {
  type: "binary" | "numeric" | "enum" | "text" | "composite" | "list";
  name?: string;
  property?: string;
  access?: number; // bitmask: 1=state/read, 2=set/write, 4=get
  unit?: string;
  value_min?: number;
  value_max?: number;
  values?: string[];
  value_on?: unknown;
  value_off?: unknown;
  features?: Z2MExpose[];
  description?: string;
}

export interface Z2MBridgeEvent {
  type: string;
  data: Record<string, unknown>;
}

// ============================================================
// Config
// ============================================================

export interface AppConfig {
  mqtt: {
    url: string;
    username?: string;
    password?: string;
    clientId: string;
  };
  z2m: {
    baseTopic: string;
  };
  sqlite: {
    path: string;
  };
  api: {
    port: number;
    host: string;
  };
  log: {
    level: string;
  };
  cors: {
    origins: string[];
  };
}
