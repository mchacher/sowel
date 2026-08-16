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
  | "temperature_device"
  | "humidity_outdoor"
  | "media_volume"
  | "media_mute"
  | "media_input"
  | "appliance_state"
  | "pool_water_temperature"
  | "pool_temperature_setpoint"
  // Spec 120 — display equipment telemetry.
  | "firmware_version"
  | "uptime"
  | "rssi"
  | "language"
  | "display_brightness"
  // Spec 133 — camera equipment. Vendor-agnostic.
  | "camera_snapshot_url"
  | "camera_stream_url"
  | "camera_monitoring"
  | "camera_light_mode"
  | "camera_detection"
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
  | "pool_cover_position"
  | "set_pool_temperature_setpoint"
  // Spec 120 — display equipment.
  | "set_language"
  | "set_display_brightness"
  // Spec 122 — display wake action. No value: the firmware restores its
  // own last user-chosen brightness. Used by presence-driven recipes so
  // the recipe does not need to know the user's preferred level.
  | "display_wake"
  // Spec 133 — camera equipment.
  | "set_camera_monitoring"
  | "set_camera_light_mode"
  | "trigger_camera_siren";

// ============================================================
// Device
// ============================================================

export type DeviceSource =
  | "zigbee2mqtt"
  | "tasmota"
  | "esphome"
  | "shelly"
  | "custom_mqtt"
  | "panasonic_cc"
  | "mcz_maestro"
  | "netatmo_hc";

export type DeviceStatus = "online" | "offline" | "unknown";

/** How a device is powered, as declared by its integration (spec 143). */
export type PowerSource = "battery" | "mains" | "dc" | "unknown";

/** An active low-battery alert (spec 143). */
export interface BatteryAlert {
  deviceDataId: string;
  deviceId: string;
  deviceName: string;
  /** Raw low value: "12" for a percentage, "true" for a battery_low flag. */
  value: string;
  raisedAt: string;
  lastNotifiedAt: string;
  /** Names of the equipments bound to this device (spec 143/#472); empty when
   *  unbound. Lets the banner show the equipment, not just the device. */
  equipmentNames?: string[];
  /** Zone of the first bound equipment, null when unbound. */
  zoneId?: string | null;
}

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
  powerSource?: PowerSource;
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
  /** Spec 120 — count of `display` equipments in this zone (+ descendants)
   *  whose EquipmentStatus === "online" vs total. */
  displaysOnline: number;
  displaysTotal: number;
  /** Per-DataCategory count of equipments excluded from aggregation because
   *  status === "offline" (spec 116). Used by the UI to render "(N unavailable)"
   *  hints next to affected metrics. */
  unavailableEquipmentsByCategory: Partial<Record<DataCategory, number>>;
}

// ============================================================
// Equipment
// ============================================================

export type EquipmentType =
  | "light_onoff"
  | "light_dimmable"
  | "light_color"
  | "shutter"
  | "awning"
  | "switch"
  | "sensor"
  | "button"
  | "thermostat"
  | "weather"
  | "weather_forecast"
  | "gate"
  | "heater"
  | "water_heater"
  | "energy_meter"
  | "main_energy_meter"
  | "energy_production_meter"
  | "solar_panel"
  | "media_player"
  | "appliance"
  | "water_valve"
  | "pool_pump"
  | "pool_cover"
  | "pool_heat_pump"
  // Spec 120 — Sowel-supervised display (energy display, e-paper, ...).
  | "display"
  // Spec 133 — surveillance camera (vendor-agnostic).
  | "camera";

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
  /** Flexible-load declaration (spec 140). Present only when arbitration is
   *  enabled for this equipment. */
  energyProfile?: EnergyLoadProfile;
  /** Spec 146 — opt-in confirmation before actuating on the mobile dashboard
   *  (gate equipments only in v1). */
  requireConfirmation?: boolean;
}

// ============================================================
// Energy capacity arbiter (spec 140)
// ============================================================

export type EnergyLoadClass = "comfort" | "deferrable";

export interface EnergyLoadProfile {
  class: EnergyLoadClass;
  nominalPowerW: number;
  minOnS: number;
  minOffS: number;
  /** Grid import (W) this load accepts to run on a partial surplus (#550). */
  toleratedImportW?: number;
  /** Core-maintained measured estimate; read-only in the UI. */
  learned?: { watts: number; atIso: string; runs: number };
}

export type ArbiterRunState = "active" | "degraded" | "disabled";

export type ArbiterDecisionKind =
  | "granted"
  | "revoked"
  | "denied"
  | "released"
  | "suspended"
  | "resumed"
  | "revoke-not-honored"
  | "comfort-off-after-revoke"
  | "watts-divergence"
  | "unclaimed-run"
  | "unclaimed-run-ended";

export interface ArbiterDecision {
  atIso: string;
  kind: ArbiterDecisionKind;
  equipmentId?: string;
  equipmentName?: string;
  watts?: number;
  reason?: string;
  note?: string;
  /** Load ON at decision time, when known (#535). Absent on legacy entries. */
  running?: boolean;
}

export interface ArbiterPublicState {
  enabled: boolean;
  state: ArbiterRunState;
  availableSurplusW: number | null;
  productionDetected: boolean;
  grants: Array<{
    equipmentId: string;
    equipmentName: string;
    instanceId: string;
    watts: number;
    sinceIso: string;
    note?: string;
  }>;
  pending: Array<{
    equipmentId: string;
    equipmentName: string;
    instanceId: string;
    watts: number;
    /** Surplus the claim waits for — `watts` minus what it will buy from the grid. */
    needW: number;
    /** Grid the claim accepts to buy; explains the gap between the two above. */
    toleratedImportW: number;
    reasonWaiting: string;
    /** Pending but its load is already running as a recipe must-run fallback
     *  (no surplus granted) — shown as "running (no surplus)", not "waiting" (#491). */
    running: boolean;
  }>;
  suspensions: Array<{ equipmentId: string; equipmentName: string; untilIso: string }>;
  journal: ArbiterDecision[];
  surplusSeries: Array<{ atIso: string; availableW: number }>;
}

/** Spec 148 (Phase B) — the Energy → arbitrage timeline read model. */
export type ArbiterQuarterState = "granted" | "revoked" | "unmanaged" | "idle";

export interface ArbiterTimelineLoad {
  equipmentId: string;
  name: string;
  quarters: ArbiterQuarterState[];
}

export interface ArbiterTimeline {
  windowStartIso: string;
  windowEndIso: string;
  stepMin: number;
  loads: ArbiterTimelineLoad[];
  surplus: Array<{ atIso: string; availableW: number }>;
  journal: ArbiterDecision[];
}

/** Derived availability of an equipment (spec 116). Computed server-side
 *  from devices.status + streaming bindings freshness. Never persisted. */
export type EquipmentStatus = "online" | "degraded" | "offline";

export interface EquipmentStatusReason {
  offlineDevices: string[];
  staleBindings: string[];
  offlineSince: string | null;
}

export interface DataBinding {
  id: string;
  equipmentId: string;
  deviceDataId: string;
  alias: string;
  historize?: number | null;
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
  /** True iff category is streaming AND lastUpdated > category timeout (spec 116). */
  stale: boolean;
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
  computedData?: ComputedDataEntry[];
  /** Derived availability (spec 116). Always present. */
  status: EquipmentStatus;
  /** Populated only when status !== "online". */
  statusReason?: EquipmentStatusReason;
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
  /** Name of the backing physical device. Used as a disambiguator when an
   * equipment has multiple bindings sharing the same category. */
  deviceName: string;
  type: string; // "number" | "boolean" | "enum"
  historize: number | null;
  effectiveOn: boolean;
}

export interface HistoryPoint {
  time: string; // ISO 8601
  value: number;
  min?: number;
  max?: number;
}

export interface HistoryQueryResult {
  points: HistoryPoint[];
  resolution: "raw" | "1h" | "1d";
  dataType?: string; // "number" | "boolean" | "enum"
  category?: string;
}

export interface RetentionStatus {
  buckets: {
    raw: { name: string; retentionSeconds: number } | null;
    hourly: { name: string; retentionSeconds: number } | null;
    daily: { name: string; retentionSeconds: number } | null;
  };
  tasks: {
    hourly: { id: string; status: string; lastRunAt?: string } | null;
    daily: { id: string; status: string; lastRunAt?: string } | null;
  };
  setupComplete: boolean;
}

// ============================================================
// Order source attribution (spec 101)
// ============================================================

export type OrderSource =
  | { kind: "recipe"; instanceId: string; recipeName: string }
  | { kind: "mode"; modeId: string; modeName: string }
  | { kind: "manual"; userId: string; userName?: string }
  | { kind: "button"; buttonId: string; buttonLabel?: string }
  | { kind: "external"; channel: string };

// ============================================================
// Activity feed (spec 101)
// ============================================================

export type ActivityCategory = "recipe" | "mode" | "motion" | "order" | "sunlight" | "alarm";

export type ActivityMessage =
  | { template: "order.executed"; params: { equipmentName: string; alias: string; value: string } }
  | {
      template: "order.executed.multi";
      params: { equipmentNames: string[]; count: number; alias: string; value: string };
    }
  | { template: "motion.detected"; params: { equipmentName: string } }
  | { template: "recipe.started"; params: { recipeName: string } }
  | { template: "recipe.stopped"; params: { recipeName: string } }
  | { template: "recipe.error"; params: { recipeName: string; error: string } }
  | { template: "mode.activated"; params: { modeName: string } }
  | { template: "mode.deactivated"; params: { modeName: string } }
  | { template: "sunlight.sunrise"; params: Record<string, never> }
  | { template: "sunlight.sunset"; params: Record<string, never> }
  | { template: "alarm.raised"; params: { source: string; message: string } };

export interface ActivityItem {
  id: string;
  timestamp: number;
  category: ActivityCategory;
  zoneId: string | null;
  message: ActivityMessage;
  source?: OrderSource;
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
  | { type: "device.heartbeat"; deviceId: string; timestamp: string }
  | { type: "zone.created"; zone: Zone }
  | { type: "zone.updated"; zone: Zone }
  | { type: "zone.removed"; zoneId: string; zoneName: string }
  | { type: "zone.data.changed"; zoneId: string; aggregatedData: ZoneAggregatedData }
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
      type: "equipment.status.changed";
      equipmentId: string;
      equipmentName: string;
      oldStatus: EquipmentStatus;
      newStatus: EquipmentStatus;
    }
  | {
      type: "equipment.order.executed";
      equipmentId: string;
      orderAlias: string;
      value: unknown;
      source?: OrderSource;
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
  | { type: "system.update.available"; current: string; latest: string; releaseUrl: string }
  | { type: "system.update.progress"; step: string; message: string }
  | { type: "system.update.error"; error: string }
  | { type: "system.restart_required"; reason: string }
  | {
      type: "equipment.order.failed";
      equipmentId: string;
      orderAlias: string;
      value: unknown;
      error: string;
      source?: OrderSource;
    }
  | { type: "activity.added"; item: ActivityItem }
  // Spec 140 — energy capacity arbiter
  | { type: "energy.capacity.granted"; equipmentId: string; instanceId: string; watts: number; note?: string }
  | { type: "energy.capacity.revoked"; equipmentId: string; instanceId: string; watts: number; reason: string }
  | { type: "energy.capacity.denied"; equipmentId: string; instanceId: string; reason: string }
  | { type: "energy.capacity.released"; equipmentId: string; instanceId: string }
  | { type: "energy.arbiter.status"; state: ArbiterRunState; availableSurplusW: number | null }
  | { type: "connected"; message: string; version: string };

// ============================================================
// Recipe
// ============================================================

export interface RecipeSlotDef {
  id: string;
  name: string;
  description: string;
  type:
    | "zone"
    | "equipment"
    | "number"
    | "duration"
    | "time"
    | "boolean"
    | "text"
    | "data-key"
    | "select";
  required: boolean;
  list?: boolean;
  defaultValue?: unknown;
  /** For `type: "select"` — the closed list of choices rendered as a dropdown.
   *  `label` is the English fallback; per-language labels live in the recipe's
   *  i18n under `slots[id].options[value]`. Spec 126. */
  options?: { value: string; label: string }[];
  /** Hide this slot in the recipe form (removed from the layout) when a sibling
   *  slot's value matches (e.g. hide a fixed-time picker when a "kind" select is
   *  sunrise/sunset). Spec 126. */
  hiddenWhen?: { slot: string; equals: string | string[] };
  constraints?: {
    equipmentType?: EquipmentType | EquipmentType[];
    min?: number;
    max?: number;
    /** When true on an `equipment` slot, the picker shows equipments
     *  from any zone (not just the recipe's zone) and disambiguates
     *  by appending the zone name in the dropdown. */
    crossZone?: boolean;
    /** When true on an `equipment` slot, the picker also includes
     *  equipments living in descendant zones of the recipe's zone. */
    includeDescendants?: boolean;
  };
  group?: string;
}

export interface RecipeSlotI18n {
  name: string;
  description: string;
  /** Per-language labels for a `select` slot's options, keyed by option value. Spec 126. */
  options?: Record<string, string>;
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
  state: Record<string, unknown>;
}

export interface RecipeLogEntry {
  id: number;
  instanceId: string;
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error";
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

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
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

export interface ModeWithDetails extends Mode {
  impacts: ZoneModeImpact[];
}

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

export type ZoneModeImpactAction =
  | { type: "order"; equipmentId: string; orderAlias: string; value: unknown }
  | { type: "recipe_toggle"; instanceId: string; enabled: boolean }
  | { type: "recipe_params"; instanceId: string; params: Record<string, unknown> };

export interface ZoneModeImpact {
  id: string;
  modeId: string;
  zoneId: string;
  actions: ZoneModeImpactAction[];
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

export interface LogsResponse {
  entries: LogEntry[];
  total: number;
  capacity: number;
  currentLevel: string;
  modules: string[];
}

// ============================================================
// Saved Charts
// ============================================================

export interface SavedChartSeriesConfig {
  equipmentId: string;
  alias: string;
  /** Series colour as `#rrggbb` (spec 145). Absent on charts saved before that
   * spec — the palette default by position applies. */
  color?: string;
}

export interface SavedChartConfig {
  series: SavedChartSeriesConfig[];
  /** Legacy relative window (`6h` / `24h` / `7d` / `30d`). Kept for backwards
   * compatibility with charts saved before the period navigator landed —
   * if `period` is present, it wins. */
  timeRange?: string;
  /** Absolute calendar period — present on charts saved with the new navigator. */
  period?: "day" | "week" | "month" | "year";
  /** Anchor date for the period (YYYY-MM-DD). Required when `period` is set. */
  date?: string;
  /** Fit the measurement Y axis to the visible data instead of anchoring it at
   * zero (spec 145). Absent = off, which is the pre-145 rendering. */
  yAxisFit?: boolean;
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
  enabled: boolean;
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

/** Web Push publisher config (spec 127) — empty; VAPID is server-global and
 *  subscriptions are stored per user. */
export type WebPushChannelConfig = Record<string, never>;

export type NotificationChannelType = "telegram" | "web-push";
export type NotificationChannelConfig = TelegramChannelConfig | WebPushChannelConfig;

export interface NotificationPublisher {
  id: string;
  name: string;
  channelType: NotificationChannelType;
  channelConfig: NotificationChannelConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A browser Web Push subscription owned by a user (spec 127). */
export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  createdAt: string;
}

export interface NotificationPublisherMapping {
  id: string;
  publisherId: string;
  message: string;
  sourceType: "equipment" | "zone" | "recipe";
  sourceId: string;
  sourceKey: string;
  throttleMs: number;
  /** Spec 128 — re-notify every `repeatMs` while the value stays active (null = off). */
  repeatMs?: number | null;
  /** Spec 128 — max reminders (null = unlimited; only with `repeatMs`). */
  repeatMax?: number | null;
  createdAt: string;
}

export interface NotificationPublisherWithMappings extends NotificationPublisher {
  mappings: NotificationPublisherMapping[];
}

// ============================================================
// Plugin
// ============================================================

export type PackageType = "integration" | "recipe";

/** Trust tier of a store entry (spec 089 official/community, spec 136 personal). */
export type PackageTier = "official" | "community" | "personal";

/** Which distribution path installed a package (spec 136). */
export type PackageSource = "registry" | "personal";

/** A user-added GitHub repo serving as a personal plugin source (spec 136). */
export interface PluginSource {
  repo: string;
  addedAt: string;
  latestVersion?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  type?: PackageType;
  /** Curated recipe category (spec 137) — one of RECIPE_CATEGORY_ORDER minus "other". */
  category?: string;
  author?: string;
  repo?: string;
  sowelVersion?: string;
  settings?: IntegrationSettingDef[];
  i18n?: Record<string, { name: string; description: string }>;
  /** Free-form registry tags — feed the search index (spec 137). */
  tags?: string[];
}

export interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
  status: IntegrationStatus;
  deviceCount: number;
  offlineDeviceCount: number;
  latestVersion?: string;
  source?: PackageSource;
}

// ============================================================
// Integration
// ============================================================

export type IntegrationStatus = "connected" | "disconnected" | "error" | "not_configured";

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
  configured: boolean;
  settings: IntegrationSettingDef[];
  settingValues: Record<string, string>;
  polling?: { lastPollAt: string; intervalMs: number };
  deviceCount: number;
  offlineDeviceCount: number;
  pluginVersion?: string;
  /** Persistent enable flag from the plugins table. When false the plugin is
   * not loaded at boot, regardless of `configured` or its runtime `status`. */
  enabled?: boolean;
  supportsOAuth?: boolean;
}

// ============================================================
// Dashboard Widget
// ============================================================

export type WidgetFamily =
  | "lights"
  | "shutters"
  | "awnings"
  | "heating"
  | "sensors"
  | "water"
  | "pool"
  // Spec 120 — Sowel-supervised displays.
  | "displays";

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
// Energy Dashboard
// ============================================================

export interface EnergyPoint {
  time: string;
  hp: number; // Wh attributed to Heures Pleines
  hc: number; // Wh attributed to Heures Creuses
  prod: number; // Wh total production
  autoconso: number; // min(prod, consumption) Wh
  injection: number; // max(0, prod - consumption) Wh
  cost_hp: number; // € (spec 123)
  cost_hc: number; // € (spec 123)
  cost_total: number; // € (spec 123)
}

export interface EnergyTotals {
  total_consumption: number; // hp + hc (Wh)
  total_hp: number; // Wh
  total_hc: number; // Wh
  total_production: number; // Wh
  total_autoconso: number; // Wh
  total_injection: number; // Wh
  cost_hp: number; // € (spec 123)
  cost_hc: number; // € (spec 123)
  cost_total: number; // € (spec 123)
}

export interface EnergyHistoryResponse {
  period: string;
  from: string;
  to: string;
  resolution: "5min" | "1h" | "1d" | "1mo"; // "1mo" added in spec 119 for the year period
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

export interface EnergyByUsagePoint {
  time: string;
  wh: number;
}

export interface SubmeterSeries {
  id: string;
  name: string;
  color: string;
  points: EnergyByUsagePoint[];
  cost: number; // € (spec 123)
}

export interface EnergyByUsageResponse {
  period: string;
  from: string;
  to: string;
  resolution: "5min" | "1h" | "1d" | "1mo"; // "1mo" added in spec 119 for the year period
  submeters: SubmeterSeries[];
  other: { points: EnergyByUsagePoint[] };
  totals: {
    byEquipment: Record<string, number>;
    other: number;
    total: number;
    costByEquipment: Record<string, number>; // spec 123
    otherCost: number; // spec 123
    totalCost: number; // spec 123
  };
}

export interface TariffSlot {
  start: string;
  end: string;
  tariff: "hp" | "hc";
}

export interface DaySchedule {
  days: number[];
  slots: TariffSlot[];
}

export interface TariffPrices {
  hp: number;
  hc: number;
}

export interface TariffConfig {
  schedules: DaySchedule[];
  prices: TariffPrices;
}
