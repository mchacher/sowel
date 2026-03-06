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
  | "noise"
  | "rain"
  | "wind"
  | "action"
  | "gate_state"
  | "generic";

// ============================================================
// Device
// ============================================================

export type DeviceSource =
  | "zigbee2mqtt"
  | "lora2mqtt"
  | "tasmota"
  | "esphome"
  | "shelly"
  | "custom_mqtt"
  | "panasonic_cc"
  | "mcz_maestro"
  | "netatmo_hc";

export type DeviceStatus = "online" | "offline" | "unknown";

export interface Device {
  id: string;
  integrationId: string;
  sourceDeviceId: string;
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
  dispatchConfig: Record<string, unknown>;
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
  sunrise: string | null;
  sunset: string | null;
  isDaylight: boolean | null;
}

// ============================================================
// Equipment
// ============================================================

export type EquipmentType =
  | "light_onoff"
  | "light_dimmable"
  | "light_color"
  | "shutter"
  | "switch"
  | "sensor"
  | "button"
  | "thermostat"
  | "weather"
  | "gate"
  | "heater";

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
  historize?: number | null; // NULL = category default, 1 = force ON, 0 = force OFF
}

// ============================================================
// History (InfluxDB)
// ============================================================

export interface HistoryStatus {
  configured: boolean;
  connected: boolean;
  enabled: boolean;
  historizedBindings: number;
  stats: { pointsWritten24h: number; errors24h: number };
}

export interface HistoryBindingState {
  bindingId: string;
  alias: string;
  category: DataCategory;
  historize: number | null; // NULL = default, 1 = force ON, 0 = force OFF
  effectiveOn: boolean; // Resolved from override → alias default → category default
}

export interface HistoryPoint {
  time: string; // ISO 8601
  value: number;
  min?: number; // Only for aggregated data
  max?: number; // Only for aggregated data
}

export interface HistoryQueryParams {
  equipmentId: string;
  alias: string;
  from: string; // ISO 8601 or relative (-24h, -7d)
  to?: string; // ISO 8601, defaults to now()
  aggregation?: "raw" | "1h" | "1d" | "auto"; // auto picks based on range
}

export interface HistoryQueryResult {
  points: HistoryPoint[];
  resolution: "raw" | "1h" | "1d";
  dataType?: string; // "number" | "boolean" | "enum" — helps frontend choose chart style
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
  historize?: number | null;
}

export interface OrderBindingWithDetails extends OrderBinding {
  deviceId: string;
  deviceName: string;
  key: string;
  type: DataType;
  dispatchConfig: Record<string, unknown>;
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
// Recipe
// ============================================================

export interface RecipeSlotDef {
  id: string;
  name: string;
  description: string;
  type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean";
  required: boolean;
  list?: boolean;
  defaultValue?: unknown;
  constraints?: {
    equipmentType?: EquipmentType | EquipmentType[];
    min?: number;
    max?: number;
  };
  group?: string;
}

export interface RecipeSlotI18n {
  name: string;
  description: string;
}

export interface RecipeLangPack {
  name: string;
  description: string;
  slots?: Record<string, RecipeSlotI18n>;
  groups?: Record<string, string>;
}

export interface RecipeActionDef {
  id: string;
  type: "cycle";
  stateKey: string;
  options: { value: string; label: string }[];
}

export interface RecipeInfo {
  id: string;
  name: string;
  description: string;
  slots: RecipeSlotDef[];
  actions?: RecipeActionDef[];
  i18n?: Record<string, RecipeLangPack>;
}

export interface RecipeInstance {
  id: string;
  recipeId: string;
  params: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

export interface RecipeLogEntry {
  id: number;
  instanceId: string;
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error";
}

// ============================================================
// Mode
// ============================================================

export interface Mode {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ZoneModeImpactAction =
  | {
      type: "order";
      equipmentId: string;
      orderAlias: string;
      value: unknown;
    }
  | {
      type: "recipe_toggle";
      instanceId: string;
      enabled: boolean;
    }
  | {
      type: "recipe_params";
      instanceId: string;
      params: Record<string, unknown>;
    };

export interface ZoneModeImpact {
  id: string;
  modeId: string;
  zoneId: string;
  actions: ZoneModeImpactAction[];
}

export interface ModeWithDetails extends Mode {
  impacts: ZoneModeImpact[];
}

// ============================================================
// Button Action Bindings
// ============================================================

export type ButtonEffectType =
  | "mode_activate"
  | "mode_toggle"
  | "equipment_order"
  | "recipe_toggle";

export interface ButtonActionBinding {
  id: string;
  equipmentId: string;
  actionValue: string;
  effectType: ButtonEffectType;
  config: Record<string, unknown>;
  createdAt: string;
}

// ============================================================
// Calendar
// ============================================================

export interface CalendarProfile {
  id: string;
  name: string;
  builtIn: boolean;
  createdAt: string;
}

export interface CalendarModeAction {
  modeId: string;
  action: "on" | "off";
}

export interface CalendarSlot {
  id: string;
  profileId: string;
  days: number[];
  time: string;
  modeActions: CalendarModeAction[];
}

// ============================================================
// User & Auth
// ============================================================

export type UserRole = "admin" | "standard";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  preferences: UserPreferences;
  enabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserPreferences {
  language: "fr" | "en";
  theme?: "light" | "dark" | "system";
  defaultZoneId?: string;
}

export interface ApiToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
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
  | {
      type: "device.heartbeat";
      deviceId: string;
      timestamp: string;
    }
  // Zone events
  | { type: "zone.created"; zone: Zone }
  | { type: "zone.updated"; zone: Zone }
  | { type: "zone.removed"; zoneId: string; zoneName: string }
  | { type: "zone.data.changed"; zoneId: string; aggregatedData: ZoneAggregatedData }
  // Equipment events
  | { type: "equipment.created"; equipment: Equipment }
  | { type: "equipment.updated"; equipment: Equipment }
  | { type: "equipment.removed"; equipmentId: string; equipmentName: string; zoneId: string }
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
  // Recipe events
  | { type: "recipe.instance.created"; instanceId: string; recipeId: string }
  | { type: "recipe.instance.removed"; instanceId: string; recipeId: string }
  | { type: "recipe.instance.started"; instanceId: string; recipeId: string }
  | { type: "recipe.instance.stopped"; instanceId: string; recipeId: string }
  | { type: "recipe.instance.error"; instanceId: string; recipeId: string; error: string }
  | { type: "recipe.instance.state.changed"; instanceId: string; recipeId: string }
  // Mode events
  | { type: "mode.created"; mode: Mode }
  | { type: "mode.updated"; mode: Mode }
  | { type: "mode.removed"; modeId: string; modeName: string }
  | { type: "mode.activated"; modeId: string; modeName: string }
  | { type: "mode.deactivated"; modeId: string; modeName: string }
  // Calendar events
  | { type: "calendar.profile.changed"; profileId: string; profileName: string }
  // Settings events
  | { type: "settings.changed"; keys: string[] }
  // Sunlight events
  | { type: "sunlight.changed" }
  // MQTT Publisher events
  | { type: "mqtt-publisher.created"; publisher: MqttPublisher }
  | { type: "mqtt-publisher.updated"; publisher: MqttPublisher }
  | { type: "mqtt-publisher.removed"; publisherId: string; publisherName: string }
  | { type: "mqtt-publisher.mapping.created"; publisherId: string; mapping: MqttPublisherMapping }
  | { type: "mqtt-publisher.mapping.removed"; publisherId: string; mappingId: string }
  // System events
  | { type: "system.started" }
  | { type: "system.integration.connected"; integrationId: string }
  | { type: "system.integration.disconnected"; integrationId: string }
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
// Integration Plugin
// ============================================================

export type IntegrationStatus = "connected" | "disconnected" | "not_configured" | "error";

export interface IntegrationSettingDef {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean";
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

export interface IntegrationInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: IntegrationStatus;
  settings: IntegrationSettingDef[];
  configured: boolean;
  polling?: { lastPollAt: string; intervalMs: number };
}

// ============================================================
// Logging
// ============================================================

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal" | "silent";

export interface LogEntry {
  level: string;
  time: string;
  module?: string;
  msg: string;
  [key: string]: unknown;
}

// ============================================================
// Saved Charts
// ============================================================

export interface SavedChartSeriesConfig {
  equipmentId: string;
  alias: string;
}

export interface SavedChartConfig {
  series: SavedChartSeriesConfig[];
  timeRange: string;
}

export interface SavedChart {
  id: string;
  name: string;
  config: SavedChartConfig;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// MQTT Publishers
// ============================================================

export interface MqttPublisher {
  id: string;
  name: string;
  topic: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MqttPublisherMapping {
  id: string;
  publisherId: string;
  publishKey: string;
  sourceType: "equipment" | "zone" | "recipe";
  sourceId: string;
  sourceKey: string;
  createdAt: string;
}

export interface MqttPublisherWithMappings extends MqttPublisher {
  mappings: MqttPublisherMapping[];
}

// ============================================================
// Config
// ============================================================

export interface AppConfig {
  sqlite: {
    path: string;
  };
  api: {
    port: number;
    host: string;
  };
  jwt: {
    secret: string;
    accessTtl: number;
    refreshTtl: number;
  };
  log: {
    level: string;
  };
  cors: {
    origins: string[];
  };
}
