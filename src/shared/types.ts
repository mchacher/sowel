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
  | "temperature_device"
  | "humidity_outdoor"
  | "media_volume"
  | "media_mute"
  | "media_input"
  | "appliance_state"
  | "pool_water_temperature"
  | "pool_temperature_setpoint"
  // Spec 120 — display equipment (generic-ish telemetry that displays
  // expose; some of these may be reused by other plugins later).
  | "firmware_version"
  | "uptime"
  | "rssi"
  | "language"
  | "display_brightness"
  // Spec 133 — camera equipment. Vendor-agnostic: a plugin only reports
  // the categories its hardware actually supports.
  | "camera_snapshot_url"
  | "camera_stream_url"
  | "camera_monitoring"
  | "camera_light_mode"
  // Momentary detection (motion/person/vehicle/animal), same modeling
  // pattern as "action" for buttons — reacted to via equipment.data.changed,
  // no bespoke EventBus event.
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
  // Wire representations for boolean orders (e.g. Z2M binary "ON"/"OFF").
  // When declared, the order dispatcher maps boolean-ish values onto them.
  valueOn?: OrderWireValue;
  valueOff?: OrderWireValue;
}

export type OrderWireValue = string | number | boolean;

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
  /**
   * Spec 120 — count of `display` equipments in this zone (+ descendants)
   * whose `EquipmentStatus === "online"` vs total. Powers the zone widget's
   * "1/2 displays online" line.
   */
  displaysOnline: number;
  displaysTotal: number;
  /**
   * Per-DataCategory count of equipments in this zone (and descendants) that
   * were skipped from aggregation because their status === "offline" (spec 116).
   * Missing keys mean zero. Lets UI render "(N unavailable)" hints next to the
   * affected metric.
   */
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
  // Spec 135 — water heater (chauffe-eau): on/off + optional water temp.
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
}

/**
 * Derived availability of an equipment (spec 116). Computed in memory from
 * the underlying devices' `status` and the freshness of streaming bindings.
 * Never persisted.
 */
export type EquipmentStatus = "online" | "degraded" | "offline";

export interface EquipmentStatusReason {
  /** Names of bound devices whose status is "offline". */
  offlineDevices: string[];
  /** Aliases of streaming bindings whose lastUpdated exceeds the timeout. */
  staleBindings: string[];
  /** Earliest lastSeen (devices) / lastUpdated (bindings) among the issues. */
  offlineSince: string | null;
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
  /** Name of the backing physical device, used as a disambiguator when an
   * equipment has multiple bindings sharing the same category (e.g. several
   * batteries on a multi-module weather station). */
  deviceName: string;
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
  /**
   * True iff the category is streaming AND lastUpdated exceeds the per-category
   * timeout (spec 116). Always false for event-based categories such as motion
   * or contact_door (absence of update is not anomaly).
   */
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
  /** Computed data not backed by device bindings (e.g. energy aggregator cumuls). */
  computedData?: ComputedDataEntry[];
  /** Derived availability (spec 116). Always present. */
  status: EquipmentStatus;
  /** Populated only when status !== "online". */
  statusReason?: EquipmentStatusReason;
}

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
   *  slot's value matches. Lets a recipe show only the relevant field, e.g. hide
   *  a fixed-time picker when a "kind" select is set to sunrise/sunset. Spec 126. */
  hiddenWhen?: { slot: string; equals: string | string[] };
  constraints?: {
    equipmentType?: EquipmentType | EquipmentType[];
    min?: number;
    max?: number;
    /** When true on an `equipment` slot, the recipe form shows
     *  equipments from any zone, not just the recipe's. */
    crossZone?: boolean;
    /** When true on an `equipment` slot, the recipe form also shows
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

/**
 * Read-only snapshot of the HP/HC tariff schedule (spec 138), handed to
 * recipes by `ctx.helpers.getTariff()`.
 *
 * Every call builds a fresh object: recipes get the schedule without any
 * handle on the TariffClassifier's cached configuration, so nothing a recipe
 * package does can corrupt energy billing. There is deliberately no setter —
 * the tariff is owned by Settings → Administration → Energy tariff.
 *
 * **Prices are deliberately absent.** Knowing *when* energy is cheap is all a
 * recipe needs to schedule a load; what it costs is commercial data, and a
 * recipe package is third-party code that can republish anything it is handed
 * (instance state goes out over the WebSocket, and MQTT/notification
 * publishers reach further still). Withholding the tariff prices removes that
 * path rather than relying on packages to behave.
 */
export interface RecipeTariff {
  /** False when no schedule is configured; the other fields are then empty. */
  configured: boolean;
  /**
   * Off-peak (heures creuses) slots in effect for the current local
   * day-of-week. A slot whose `end` is not after its `start` wraps past
   * midnight — e.g. `{ start: "22:00", end: "06:00" }`.
   */
  offPeakToday: TariffSlot[];
  /** Whether the current local time falls in an off-peak slot; null when unconfigured. */
  isOffPeakNow: boolean | null;
}

/** Helpers exposed to recipe packages via ctx.helpers */
export interface RecipeHelpers {
  isAnyLightOn(lightIds: string[], ctx: RecipeCtx): boolean;
  turnOnLights(lightIds: string[], ctx: RecipeCtx): string[];
  turnOffLights(lightIds: string[], ctx: RecipeCtx): string[];
  setLightsBrightness(lightIds: string[], ctx: RecipeCtx, brightness: number): string[];
  parseDuration(value: unknown): number;
  formatDuration(ms: number): string;
  /** Current sunlight times (HH:MM) + daylight flag from the SunlightManager
   *  (spec 023 offsets applied). Pair with the `sunlight.changed` event to
   *  re-sync across days. Fields are null when not yet computed or no home
   *  coordinates are configured. Spec 126. */
  getSunlight(): { sunrise: string | null; sunset: string | null; isDaylight: boolean | null };
  /** Current HP/HC tariff schedule, read-only (spec 138). `configured` is
   *  false when the user has not filled Settings → Administration → Energy
   *  tariff, in which case a recipe should fall back to its own parameters. */
  getTariff(): RecipeTariff;
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
      source?: OrderSource;
    }
  | {
      type: "equipment.order.failed";
      equipmentId: string;
      orderAlias: string;
      value: unknown;
      error: string;
      source?: OrderSource;
    }
  | {
      type: "equipment.status.changed";
      equipmentId: string;
      equipmentName: string;
      oldStatus: EquipmentStatus;
      newStatus: EquipmentStatus;
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
  | { type: "system.restart_required"; reason: string }
  // Activity feed (spec 101)
  | { type: "activity.added"; item: ActivityItem };

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

/** Trust tier of a store entry (spec 089 official/community, spec 136 personal). */
export type PackageTier = "official" | "community" | "personal";

/** Which distribution path installed a package (spec 136). */
export type PackageSource = "registry" | "personal";

/** A user-added GitHub repo serving as a personal plugin source (spec 136). */
export interface PluginSource {
  repo: string; // "owner/repo"
  addedAt: string;
  /** Latest release version from GitHub, undefined if none or unreachable. */
  latestVersion?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string; // Lucide icon name
  repo: string; // GitHub owner/repo — required for backup/restore reinstall
  type?: PackageType; // defaults to "integration" for backward compat
  /** Curated recipe category (spec 137) — one of RECIPE_CATEGORIES; invalid values ignored. */
  category?: string;
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
  source: PackageSource; // spec 136 — which path installed it
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
  source: PackageSource; // spec 136 — which path installed it
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
  /** Legacy relative window (`6h` / `24h` / `7d` / `30d`). Kept for backwards
   * compatibility with charts saved before the period navigator landed —
   * if `period` is present, it wins. */
  timeRange?: string;
  /** Absolute calendar period — present on charts saved with the new navigator. */
  period?: "day" | "week" | "month" | "year";
  /** Anchor date for the period (YYYY-MM-DD). Required when `period` is set. */
  date?: string;
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

/** Web Push (spec 127) has no per-publisher credentials: VAPID keys are
 *  server-global (in settings) and device subscriptions are stored separately
 *  in `push_subscriptions`. A web-push publisher broadcasts to all subscriptions. */
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

/** A browser Web Push subscription, owned by a user (spec 127). */
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
  /** Spec 128 — re-notify every `repeatMs` while the value stays active.
   *  null = no re-notification. */
  repeatMs?: number | null;
  /** Spec 128 — max reminders after the initial notification (excludes it).
   *  null = unlimited (only meaningful when `repeatMs` is set). */
  repeatMax?: number | null;
  createdAt: string;
}

export interface NotificationPublisherWithMappings extends NotificationPublisher {
  mappings: NotificationPublisherMapping[];
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
// Config
// ============================================================

// ============================================================
// Audit log (spec 113)
// ============================================================

export type AuditActorKind = "user" | "api_token" | "system";

export interface AuditEntry {
  actorKind: AuditActorKind;
  actorUserId?: string | null;
  actorLabel: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface AuditEntryRow extends AuditEntry {
  id: string;
  timestamp: string;
}

export interface AuditQueryParams {
  actorUserId?: string;
  actionPrefix?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

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
  /**
   * Spec 124 — when true, every outbound subsystem is gated off at
   * boot AND at runtime. Used to run a candidate build against a copy
   * of production state without affecting production. Set via
   * `SOWEL_SHADOW_MODE=1`.
   */
  shadowMode: boolean;
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
  cost_total: number; // € = cost_hp + cost_hc (spec 123)
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
  cost_total: number; // € = cost_hp + cost_hc (spec 123)
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
  cost: number; // € for the whole series (spec 123)
}

export interface EnergyByUsageResponse {
  period: string;
  from: string;
  to: string;
  resolution: "5min" | "1h" | "1d" | "1mo"; // "1mo" added in spec 119 for the year period
  submeters: SubmeterSeries[];
  /** Residual = main meter consumption minus sum of submeters (clamped ≥ 0). Empty if no main meter. */
  other: { points: EnergyByUsagePoint[] };
  totals: {
    byEquipment: Record<string, number>;
    other: number;
    total: number;
    costByEquipment: Record<string, number>; // € per equipment (spec 123)
    otherCost: number; // € (spec 123)
    totalCost: number; // € (spec 123)
  };
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
