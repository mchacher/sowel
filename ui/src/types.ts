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
  // Spec 152 — solar command channel state feedback (states family, spec 144).
  | "solar_state"
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
  // Spec 156 — UPS. `ups_status` is a closed, severity-ordered enum;
  // `battery_runtime` is the remaining autonomy in seconds; `ups_load` is the
  // output load as a percentage of nominal power (never `power` — spec 156 FR3).
  | "ups_status"
  | "battery_runtime"
  | "ups_load"
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
  | "trigger_camera_siren"
  // Spec 152 — solar force command channel (dedicated on/off, distinct from the
  // main on/off; driven by the surplus arbiter recipe).
  | "solar_toggle";

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
  /** Spec 170 — live sum, in whole watts, of the consumption submeters in this
   *  zone and its descendants. `null` when there was nothing current to sum,
   *  which is not the same as a measured 0 W. */
  powerTotal: number | null;
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
  | "camera"
  // Spec 153 — mechanical ventilation (VMC), 2-speed: OFF / V1 / V2.
  | "vmc"
  // Spec 156 — uninterruptible power supply, read-only.
  | "ups";

/** Spec 160 — one coplanar group of panels. */
export interface SolarPlane {
  tiltDeg: number;
  azimuthDeg: number;
  peakWc: number;
}

export interface SolarProfile {
  planes: SolarPlane[];
  /**
   * ISO date. The array has been in this configuration since (spec 161).
   *
   * Only ever used to bound a backfill over existing history: fitted across a
   * capacity change the gain describes neither array. The forward path never
   * reads it.
   */
  since?: string;
}

/** Spec 160 — one hour of the expected-production curve. */
export interface PvForecastPoint {
  at: string;
  watts: number;
}

export interface PvAccuracyPoint {
  at: string;
  forecastW: number;
  actualW: number;
}

export interface PvForecastResponse {
  active: boolean;
  declaredPeakWc: number;
  planes: SolarPlane[];
  curve: PvForecastPoint[];
  /** When the weather series behind the curve was issued. Null before the first. */
  issuedAt: string | null;
  /** False when no plugin publishes the irradiance series the curve needs. */
  weatherAvailable: boolean;
  /** Spec 161 — the declared "unchanged since" date, when there is one. */
  since?: string;
  accuracy: {
    samples: number;
    /** Hourly power MAE. Kept for compatibility, no longer displayed (#907). */
    maeW: number | null;
    /** Mean absolute error on the daily energy, Wh, over complete days. */
    dailyMaeWh: number | null;
    /** The same error as a share of the production over those days, percent. */
    dailyMaePct: number | null;
    /** Complete days behind the daily figures. */
    dailyDays: number;
    /** The running day so far: expected and measured over the SAME hours. */
    today: { day: string; forecastWh: number; actualWh: number; hours: number } | null;
    points: PvAccuracyPoint[];
    /**
     * Every hour the meter recorded over the window, paired or not. The chart's
     * measured line comes from here, never from `points` — a household with no
     * forecast history yet still has production worth drawing.
     */
    measured: { at: string; watts: number }[];
  };
  model: {
    gain: number;
    shape: Record<number, number>;
    fittedAt: string;
    samples: number;
  } | null;
}

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
  /** Spec 173 — id of the meter that already counts this equipment's
   *  consumption. The by-usage breakdown renders that parent net of its direct
   *  children. `null`/absent = counted nowhere else. */
  meteringParentId?: string | null;
  /** Spec 177 — this meter is fed by a separate supply: its consumption never
   *  flows through the main meter. Rendered apart from every reconciliation
   *  (by-usage partition, live donut, `other`, cost). Default false. */
  separateSupply?: boolean;
  /** Spec 154 — invert shutter-family command direction (shutter_move
   *  OPEN<->CLOSE, set_shutter_position -> 100-value). Command-only; ignored for
   *  non-shutter-family types. */
  invertDirection?: boolean;
  /** Spec 174 phase 2 — the timed command this equipment offers, absent when it
   *  offers none. Configuration; the window running is `timedAction`. */
  timedCommand?: TimedCommand | null;
  /** Spec 160 — declared array geometry. */
  solarProfile?: SolarProfile;
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
  /** Shutdown inertia (s) — how long the load keeps drawing after a revoke
   *  before its export returns; widens the arbiter's revoke-not-honored grace
   *  for this load only (#631). Absent = global releaseHoldS. */
  releaseDelayS?: number;
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
  | "unclaimed-run-ended"
  | "waiting"
  /** Spec 164 — granted, but the load's own measurement says nothing is
   *  consuming the surplus (`draw-started` = consuming again). */
  | "draw-stopped"
  | "draw-started"
  | "reset";

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

/**
 * Spec 165 — the state of one flexible load, now or in a past time step. One
 * union for the roster table and the timeline ribbon, so a state cannot be
 * added to one and forgotten on the other.
 */
export type ArbiterLoadState =
  | "granted"
  /** Spec 164 — granted, and measured consuming nothing. */
  | "granted-idle"
  | "pending"
  | "unmanaged"
  | "suspended"
  | "idle";

/** Spec 165 — one roster row, with its state resolved by the engine. Figures
 *  irrelevant to a state are null and render as a dash. */
export interface ArbiterLoadInfo {
  equipmentId: string;
  equipmentName: string;
  state: ArbiterLoadState;
  watts: number | null;
  /** #807 — `watts + margin - tolerated`, on every row that has watts, from
   *  the row's own basis: the reserved/measured draw of a grant, the claim's
   *  figure while waiting, the rating at rest. Negative when the tolerance
   *  exceeds the draw, which the roster renders as 0 W. */
  needW: number | null;
  /** #807 — pending only: the surplus still missing before the claim can be
   *  granted. Null on every other state. */
  shortfallW: number | null;
  toleratedImportW: number | null;
  sinceIso?: string;
  reasonWaiting?: string;
  untilIso?: string;
  instanceId?: string;
  note?: string;
}

export interface ArbiterPublicState {
  enabled: boolean;
  state: ArbiterRunState;
  availableSurplusW: number | null;
  productionDetected: boolean;
  /** Spec 165 — every declared flexible load, in priority order, state already
   *  resolved. The single source the roster renders. */
  loads: ArbiterLoadInfo[];
  /** Spec 165 (#577) — sun down and nothing to share: a waiting claim reads as
   *  at rest, in the roster AND in the ribbon's current cell. */
  dormant: boolean;
  /** #807 - the configured engage margin, stated under the roster table. */
  engageMarginW: number;
  /** @deprecated Spec 165 — superseded by `loads`. */
  grants: Array<{
    equipmentId: string;
    equipmentName: string;
    instanceId: string;
    watts: number;
    sinceIso: string;
    note?: string;
  }>;
  /** @deprecated Spec 165 — superseded by `loads`. */
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
  /** @deprecated Spec 165 — superseded by `loads`. */
  suspensions: Array<{ equipmentId: string; equipmentName: string; untilIso: string }>;
  /** @deprecated Spec 165 — superseded by `loads`. #561 — declared flexible
   *  loads with no active claim (at rest / running outside arbitration). */
  idle: Array<{
    equipmentId: string;
    equipmentName: string;
    watts: number;
    toleratedImportW: number;
    /** No claim yet running as a recipe must-run fallback — "running outside
     *  arbitration", not "at rest" (mirrors #491). */
    runningUnmanaged: boolean;
  }>;
  /** #616 — configured load priority, highest first (equipmentId order). Lets
   *  the roster table list loads in priority order, matching the timeline. */
  priority: string[];
  journal: ArbiterDecision[];
  surplusSeries: Array<{ atIso: string; availableW: number }>;
}

/**
 * Spec 148 (Phase B) — the Energy → arbitrage timeline read model. A step also
 * carries `revoked`: an EVENT inside the step, never a state a load is in. The
 * ribbon never emits `suspended` (spec 165 non-goal).
 */
export type ArbiterQuarterState = ArbiterLoadState | "revoked";

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
  /**
   * How old this reading may be and still be drawn as live, derived from the
   * source's own cadence (spec 175). Power bindings only; absent means the
   * engine did not resolve it and the surface falls back to the learning
   * window, never that there is no budget.
   */
  freshnessBudgetMs?: number;
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

/** Spec 174 phase 2 — what a timed control arms. `value` may equal `revertValue`
 *  (an impulse gate is opened and closed by one command) and either may be null. */
export interface TimedCommand {
  alias: string;
  value: unknown;
  revertValue: unknown;
  durationMs: number;
}

/** Spec 174 — the window currently running on an equipment. */
export interface TimedAction {
  alias: string;
  value: unknown;
  revertValue: unknown;
  /** ISO-8601 instant the revert is owed at. */
  expiresAt: string;
  armedAt: string;
  armedBy?: string;
}

export interface EquipmentWithDetails extends Equipment {
  dataBindings: DataBindingWithValue[];
  orderBindings: OrderBindingWithDetails[];
  computedData?: ComputedDataEntry[];
  /** Derived availability (spec 116). Always present. */
  status: EquipmentStatus;
  /** Populated only when status !== "online". */
  statusReason?: EquipmentStatusReason;
  /** Spec 174 — present only while a timed window is running. */
  timedAction?: TimedAction;
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
  | { template: "alarm.raised"; params: { source: string; message: string } }
  | { template: "alarm.resolved"; params: { source: string; message: string } };

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
  /* Spec 174 — a timed window opening, ending, or failing to end. The equipment
     row itself is untouched, so these are not `equipment.updated`. */
  | {
      type: "equipment.timed_action.armed";
      equipmentId: string;
      equipmentName: string;
      orderAlias: string;
      value: unknown;
      revertValue: unknown;
      expiresAt: number;
      extended: boolean;
      source?: OrderSource;
    }
  | {
      type: "equipment.timed_action.reverted";
      equipmentId: string;
      equipmentName: string;
      orderAlias: string;
      revertValue: unknown;
      reason: string;
    }
  | {
      type: "equipment.timed_action.disarmed";
      equipmentId: string;
      equipmentName: string;
      orderAlias: string;
      reason: string;
    }
  | {
      type: "equipment.timed_action.failed";
      equipmentId: string;
      equipmentName: string;
      orderAlias: string;
      revertValue: unknown;
      error: string;
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
  | { type: "system.update.error"; error: string; operation: "update" | "restart" }
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
  | {
      type: "energy.capacity.granted";
      equipmentId: string;
      instanceId: string;
      watts: number;
      note?: string;
    }
  | {
      type: "energy.capacity.revoked";
      equipmentId: string;
      instanceId: string;
      watts: number;
      reason: string;
    }
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

/**
 * Opt-in Dashboard tile, declared by a recipe package (spec 169).
 *
 * A recipe knows whether it has anything worth watching at a glance; most do
 * not. So the declaration lives here rather than in the core: a definition
 * without `tile` is never listed in the widget picker and never pinnable.
 * The core renders what the recipe declared — it does not decide what a
 * recipe means.
 */
export interface RecipeTileDef {
  /**
   * Icon key from the tile icon set (`RecipeTile.TILE_ICONS` — ChefHat, Truck,
   * Timer, Droplets, Flame, …). A closed set, so the UI keeps tree-shaking its
   * icon package; an unknown key falls back to the default rather than failing.
   */
  icon?: string;
  /** Instance-state key holding the one-line status. Default `"summary"`. */
  summaryKey?: string;
  /** Instance-state key holding an ISO deadline to count down. Default `"timerExpiresAt"`. */
  countdownKey?: string;
  /** Ids from this recipe's `actions` exposed as controls on the tile. */
  actions?: string[];
  /**
   * Set when firing this tile moves something physical — a gate, a door, a
   * pump. The Dashboard card then asks for a slide-to-confirm on mobile before
   * it acts (spec 171), the same guard spec 146 gives a gate equipment. The
   * tile's own control is unaffected: a 10 px pill is already a deliberate aim.
   */
  confirm?: boolean;
  /**
   * Id of a `boolean` slot letting the user decide, instance by instance,
   * whether that confirmation is asked — the recipe's answer to the toggle a
   * gate equipment carries. Its value wins over `confirm`, which stays the
   * default for an instance that has never been given one.
   */
  confirmParam?: string;
  /**
   * Id of the `equipment` slot the tile's single control actuates. When it
   * resolves, that equipment's own "Confirmation before action" (spec 146)
   * decides whether the card asks, and `confirm` / `confirmParam` are not
   * consulted: the answer is given once, on the equipment, and every surface
   * that actuates it asks the same question.
   *
   * Only the recipe can know whether such a derivation is meaningful — an
   * action touching several equipments, or none directly, or doing more than
   * the equipment's own order, cannot derive anything — so this is a
   * declaration, never something the core infers.
   */
  confirmFrom?: string;
}

export interface RecipeInfo {
  id: string;
  name: string;
  description: string;
  slots: RecipeSlotDef[];
  actions?: RecipeActionDef[];
  /** Spec 169 — present only when the package declares a Dashboard tile. */
  tile?: RecipeTileDef;
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
  /** Spec 151 — days a trusted device stays valid once issued. 1-90, default
   *  30 when absent. Clamped server-side in `PUT /me/preferences`. */
  mfaTrustedDeviceDays?: number;
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
// Two-factor authentication (spec 151)
// ============================================================

export interface MfaStatus {
  enabled: boolean;
  confirmedAt: string | null;
  backupCodesRemaining: number;
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface MfaConfirmResponse {
  backupCodes: string[];
}

export interface MfaTrustedDevice {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Returned by `POST /auth/login` instead of `AuthTokens` when the account
 *  has confirmed TOTP MFA and no valid trusted-device token was presented. */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
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
  | "displays"
  // Spec 153 — mechanical ventilation (VMC).
  | "ventilation"
  // Spec 156 — power protection (UPS).
  | "power";

export interface WidgetConfig {
  /** Sensor widget: list of binding aliases to display (undefined = show all) */
  visibleBindings?: string[];
  /** Spec 174 phase 2 — this tile arms the equipment's timed command. Set on a
   *  second widget for the same equipment, beside the ordinary one. */
  timed?: boolean;
}

export interface DashboardWidget {
  id: string;
  type: "equipment" | "zone" | "recipe";
  label?: string;
  icon?: string;
  config?: WidgetConfig;
  equipmentId?: string;
  zoneId?: string;
  /** Spec 169 — set on `recipe` widgets, whose recipe declares a tile. */
  recipeInstanceId?: string;
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
  /** Spec 173 — shown net of the meters declared inside this one. */
  netOfChildren?: boolean;
}

export interface EnergyByUsageResponse {
  period: string;
  from: string;
  to: string;
  resolution: "5min" | "1h" | "1d" | "1mo"; // "1mo" added in spec 119 for the year period
  submeters: SubmeterSeries[];
  /** Spec 177 — meters on a separate supply: raw, uncosted, never in the
   *  partition. Absent when no equipment declares the flag. */
  separateSupply?: SubmeterSeries[];
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
