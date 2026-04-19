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
  | "generic";

export type OrderCategory =
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
  | "pool_cover_position";

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
  category?: OrderCategory;

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
  waterValvesOpen: number;
  waterValvesTotal: number;
  waterFlowTotal: number | null;
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
  | "weather_forecast"
  | "gate"
  | "heater"
  | "energy_meter"
  | "main_energy_meter"
  | "energy_production_meter"
  | "media_player"
  | "appliance"
  | "water_valve"
  | "pool_pump"
  | "pool_cover";

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
  enumValues?: string[];
  lastUpdated: string | null;
  lastChanged: string | null;
  historize?: number | null;
}

export interface OrderBindingWithDetails extends OrderBinding {
  deviceId: string;
  deviceName: string;
  key: string;
  type: DataType;
  category?: OrderCategory;

  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}

/** A computed data value not backed by a device binding (e.g. energy cumuls). */
export interface ComputedDataEntry {
  alias: string;
  value: unknown;
  unit?: string;
  category?: DataCategory;
  lastUpdated: string | null;
}

export interface EquipmentWithDetails extends Equipment {
  dataBindings: DataBindingWithValue[];
  orderBindings: OrderBindingWithDetails[];
  /** Computed data not backed by device bindings (e.g. energy aggregator cumuls). */
  computedData?: ComputedDataEntry[];
}

// ============================================================
// Recipe
// ============================================================

export interface RecipeSlotDef {
  id: string;
  name: string;
  description: string;
  type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean" | "text" | "data-key";
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

/** Handle returned by RecipeDefinition.createInstance() */
export interface RecipeInstanceHandle {
  stop(): void;
  onAction?(action: string, payload?: Record<string, unknown>): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RecipeCtx = any; // RecipeContext at runtime — external packages can't import the concrete type

/** External recipe definition — returned by createRecipe() factory in recipe packages */
export interface RecipeDefinition {
  id: string;
  name: string;
  description: string;
  slots: RecipeSlotDef[];
  actions?: RecipeActionDef[];
  i18n?: Record<string, RecipeLangPack>;
  validate(params: Record<string, unknown>, ctx: RecipeCtx): void;
  createInstance(params: Record<string, unknown>, ctx: RecipeCtx): RecipeInstanceHandle;
}

/** Helpers exposed to recipe packages via ctx.helpers */
export interface RecipeHelpers {
  isAnyLightOn(lightIds: string[], ctx: RecipeCtx): boolean;
  turnOnLights(lightIds: string[], ctx: RecipeCtx): string[];
  turnOffLights(lightIds: string[], ctx: RecipeCtx): string[];
  setLightsBrightness(lightIds: string[], ctx: RecipeCtx, brightness: number): string[];
  parseDuration(value: unknown): number;
  formatDuration(ms: number): string;
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
  | "recipe_toggle"
  | "zone_order";

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
      /** Optional source timestamp (epoch seconds) for aligned time-series writes. */
      sourceTimestamp?: number;
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
      /** Optional source timestamp (epoch seconds) for aligned time-series writes. */
      sourceTimestamp?: number;
    }
  | {
      type: "equipment.order.executed";
      equipmentId: string;
      orderAlias: string;
      value: unknown;
    }
  | {
      type: "equipment.order.failed";
      equipmentId: string;
      orderAlias: string;
      value: unknown;
      error: string;
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
  // MQTT Broker events
  | { type: "mqtt-broker.created"; broker: MqttBroker }
  | { type: "mqtt-broker.updated"; broker: MqttBroker }
  | { type: "mqtt-broker.removed"; brokerId: string }
  // MQTT Publisher events
  | { type: "mqtt-publisher.created"; publisher: MqttPublisher }
  | { type: "mqtt-publisher.updated"; publisher: MqttPublisher }
  | { type: "mqtt-publisher.removed"; publisherId: string; publisherName: string }
  | { type: "mqtt-publisher.mapping.created"; publisherId: string; mapping: MqttPublisherMapping }
  | { type: "mqtt-publisher.mapping.removed"; publisherId: string; mappingId: string }
  // Notification Publisher events
  | { type: "notification-publisher.created"; publisher: NotificationPublisher }
  | { type: "notification-publisher.updated"; publisher: NotificationPublisher }
  | { type: "notification-publisher.removed"; publisherId: string; publisherName: string }
  | {
      type: "notification-publisher.mapping.created";
      publisherId: string;
      mapping: NotificationPublisherMapping;
    }
  | { type: "notification-publisher.mapping.removed"; publisherId: string; mappingId: string }
  // System events
  | { type: "system.started" }
  | { type: "system.integration.connected"; integrationId: string }
  | { type: "system.integration.disconnected"; integrationId: string }
  | { type: "system.error"; error: string }
  | {
      type: "system.alarm.raised";
      alarmId: string;
      level: "warning" | "error";
      source: string;
      message: string;
    }
  | { type: "system.alarm.resolved"; alarmId: string; source: string; message: string }
  // Self-update events
  | { type: "system.update.available"; current: string; latest: string; releaseUrl: string }
  | { type: "system.update.progress"; step: string; message: string }
  | { type: "system.update.error"; error: string }
  // Restart required (e.g. after home location / timezone change)
  | { type: "system.restart_required"; reason: string };

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
  deviceCount: number;
  offlineDeviceCount: number;
  /** True if the integration supports OAuth 2.0 authorization flow */
  supportsOAuth?: boolean;
}

// ============================================================
// Package / Plugin Engine
// ============================================================

export type PackageType = "integration" | "recipe";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string; // Lucide icon name
  repo: string; // GitHub owner/repo — required for backup/restore reinstall
  type?: PackageType; // defaults to "integration" for backward compat
  author?: string;
  sowelVersion?: string;
  settings?: IntegrationSettingDef[];
}

/** Raw package data from DB — no runtime info */
export interface InstalledPackage {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
  type: PackageType;
}

/** Enriched with runtime integration info (status, device counts) */
export interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
  status: IntegrationStatus; // connected/disconnected/error/not_configured
  deviceCount: number;
  offlineDeviceCount: number;
  latestVersion?: string; // set when a newer version is available in registry
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
// MQTT Brokers
// ============================================================

export interface MqttBroker {
  id: string;
  name: string;
  url: string;
  username?: string;
  password?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// MQTT Publishers
// ============================================================

export interface MqttPublisher {
  id: string;
  name: string;
  brokerId: string | null;
  topic: string;
  enabled: boolean;
  onChangeOnly: boolean;
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
// Notification Publishers
// ============================================================

export interface TelegramChannelConfig {
  botToken: string;
  chatId: string;
}

export interface NotificationPublisher {
  id: string;
  name: string;
  channelType: "telegram";
  channelConfig: TelegramChannelConfig;
  enabled: boolean;
  /** Minutes between automatic re-sends while a system alarm stays unresolved.
   * 0 (or undefined) disables reminders — the historical one-shot behaviour. */
  alarmReminderMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPublisherMapping {
  id: string;
  publisherId: string;
  message: string;
  sourceType: "equipment" | "zone" | "recipe";
  sourceId: string;
  sourceKey: string;
  throttleMs: number;
  createdAt: string;
}

export interface NotificationPublisherWithMappings extends NotificationPublisher {
  mappings: NotificationPublisherMapping[];
}

// ============================================================
// Dashboard Widget
// ============================================================

export type WidgetFamily = "lights" | "shutters" | "heating" | "sensors" | "water" | "pool";

export interface WidgetConfig {
  /** Sensor widget: list of binding aliases to display (undefined = show all) */
  visibleBindings?: string[];
}

export interface DashboardWidget {
  id: string;
  type: "equipment" | "zone";
  label?: string;
  icon?: string;
  config?: WidgetConfig;
  equipmentId?: string;
  zoneId?: string;
  family?: WidgetFamily;
  displayOrder: number;
  createdAt: string;
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
  influx: {
    url: string;
    token: string;
    org: string;
    bucket: string;
  };
}

// ============================================================
// Energy Dashboard
// ============================================================

export interface EnergyPoint {
  time: string;
  hp: number; // Wh attributed to Heures Pleines
  hc: number; // Wh attributed to Heures Creuses
  prod: number; // Wh total production
  autoconso: number; // min(prod, consumption) Wh
  injection: number; // max(0, prod - consumption) Wh
}

export interface EnergyTotals {
  total_consumption: number; // hp + hc (Wh)
  total_hp: number; // Wh
  total_hc: number; // Wh
  total_production: number; // Wh
  total_autoconso: number; // Wh
  total_injection: number; // Wh
}

export interface EnergyHistoryResponse {
  period: string;
  from: string;
  to: string;
  resolution: "5min" | "1h" | "1d";
  points: EnergyPoint[];
  totals: EnergyTotals;
}

export interface EnergyStatus {
  available: boolean;
  hasProduction: boolean;
  sources: string[];
  lastDataAt: string | null;
  tariffConfigured: boolean;
}

// ============================================================
// Tariff Configuration
// ============================================================

export interface TariffSlot {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  tariff: "hp" | "hc";
}

export interface DaySchedule {
  days: number[]; // 0=Sunday..6=Saturday
  slots: TariffSlot[];
}

export interface TariffPrices {
  hp: number; // €/kWh
  hc: number; // €/kWh
}

export interface TariffConfig {
  schedules: DaySchedule[];
  prices: TariffPrices;
}

export interface TariffSplit {
  hp: number; // Wh attributed to HP
  hc: number; // Wh attributed to HC
}
