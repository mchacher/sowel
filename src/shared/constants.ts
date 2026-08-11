import type {
  DataCategory,
  DataType,
  EnergyLoadClass,
  EquipmentType,
  WidgetFamily,
} from "./types.js";

// ============================================================
// Root Zone — "Maison" is the root of the zone hierarchy
// ============================================================

/** Well-known ID for the root zone "Maison". */
export const ROOT_ZONE_ID = "00000000-0000-0000-0000-000000000001";

// ============================================================
// DataCategory inference from zigbee2mqtt expose property names
// ============================================================

/**
 * Maps z2m expose property names to DataCategory.
 * Used by category-inference.ts to determine the semantic category of a DeviceData.
 */
export const PROPERTY_TO_CATEGORY: Record<string, DataCategory> = {
  // Motion / presence
  occupancy: "motion",
  presence: "motion",

  // Temperature
  temperature: "temperature",
  device_temperature: "temperature",
  soil_temperature: "temperature",

  // Humidity
  humidity: "humidity",
  soil_moisture: "humidity",

  // Pressure
  pressure: "pressure",
  atmospheric_pressure: "pressure",

  // Luminosity
  illuminance: "luminosity",
  illuminance_lux: "luminosity",

  // Contact sensors
  contact: "contact_door", // Default to door; can be overridden per device

  // Light state
  state: "light_state", // context-dependent, refined by device type check

  // Light brightness
  brightness: "light_brightness",

  // Light color temperature
  color_temp: "light_color_temp",

  // Light color
  color: "light_color",
  color_xy: "light_color",
  color_hs: "light_color",

  // Shutter / cover
  position: "shutter_position",
  cover_position: "shutter_position",

  // Lock
  lock_state: "lock_state",
  child_lock: "lock_state",

  // Battery
  battery: "battery",
  battery_low: "battery",

  // Power / energy
  power: "power",
  power_on_behavior: "generic",
  energy: "energy",
  voltage: "voltage",
  current: "current",

  // Water leak
  water_leak: "water_leak",

  // Smoke
  smoke: "smoke",

  // Air quality
  co2: "co2",
  voc: "voc",

  // Noise
  noise: "noise",

  // Wind
  wind_strength: "wind",
  wind_angle: "wind",
  gust_strength: "wind",
  gust_angle: "wind",

  // Rain
  rain: "rain",
  sum_rain_1: "rain",
  sum_rain_24: "rain",

  // Button / remote action
  action: "action",

  // LoRa sensors (lora2mqtt data keys)
  BMP180_T: "temperature",
  BMP180_P: "pressure",
  SCD30_T: "temperature",
  SCD30_CO2: "co2",
  SCD30_HR: "humidity",
  vcc: "voltage",
};

// ============================================================
// Z2M expose type → DataType mapping
// ============================================================

export const Z2M_TYPE_TO_DATA_TYPE: Record<string, DataType> = {
  binary: "boolean",
  numeric: "number",
  enum: "enum",
  text: "text",
  composite: "json",
  list: "json",
};

// ============================================================
// LoRa2MQTT type → DataType mapping
// ============================================================

export const LORA_TYPE_TO_DATA_TYPE: Record<string, DataType> = {
  numeric: "number",
  binary: "boolean",
  enum: "enum",
};

// ============================================================
// Z2M expose access bitmask
// ============================================================

/** Expose access: the property publishes state (readable) */
export const Z2M_ACCESS_STATE = 0b001; // 1

/** Expose access: the property accepts /set commands (writable) */
export const Z2M_ACCESS_SET = 0b010; // 2

/** Expose access: the property supports /get requests */
export const Z2M_ACCESS_GET = 0b100; // 4

// ============================================================
// Properties whose "state" category depends on device context
// ============================================================

/**
 * Properties that map to "light_state" only when the device is a light.
 * For non-light devices (switches, plugs), "state" maps to "generic".
 */
export const LIGHT_INDICATOR_PROPERTIES = new Set([
  "brightness",
  "color_temp",
  "color",
  "color_xy",
  "color_hs",
]);

// ============================================================
// Widget Family → EquipmentType mapping
// ============================================================

export const WIDGET_FAMILY_TYPES: Record<WidgetFamily, EquipmentType[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  awnings: ["awning"],
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
  water: ["water_valve"],
  pool: ["pool_pump", "pool_cover", "pool_heat_pump"],
  // Spec 120 — Sowel-supervised displays.
  displays: ["display"],
};

// ============================================================
// Equipment availability — streaming categories (spec 116)
// ============================================================

/**
 * Categories where the device pushes a value at regular intervals, even when
 * unchanged. Absence of update past the timeout = anomaly. Event-based
 * categories (motion, contact_door, action, light_state, shutter_position…)
 * are intentionally NOT here: a PIR not firing for 3 weeks is normal.
 */
export const STREAMING_CATEGORIES: ReadonlySet<DataCategory> = new Set<DataCategory>([
  "power",
  "energy",
  "voltage",
  "current",
  "temperature",
  "temperature_outdoor",
  "temperature_device",
  "humidity",
  "humidity_outdoor",
  "pressure",
  "luminosity",
  "co2",
  "voc",
  "noise",
  "battery",
  "setpoint",
  "pool_water_temperature",
  "pool_temperature_setpoint",
]);

/**
 * Per-category freshness window. A streaming binding whose lastUpdated is
 * older than this value is flagged stale (spec 116). Categories listed in
 * STREAMING_CATEGORIES but missing here fall back to DEFAULT_STREAMING_TIMEOUT_MS.
 */
export const STREAMING_TIMEOUT_MS: Partial<Record<DataCategory, number>> = {
  power: 2 * 60 * 1000, // 2 min — live electrical reads
  energy: 10 * 60 * 1000, // 10 min — cumulative counter
  voltage: 5 * 60 * 1000,
  current: 5 * 60 * 1000,
  temperature: 15 * 60 * 1000,
  temperature_outdoor: 15 * 60 * 1000,
  temperature_device: 15 * 60 * 1000,
  humidity: 15 * 60 * 1000,
  humidity_outdoor: 15 * 60 * 1000,
  pressure: 30 * 60 * 1000,
  luminosity: 15 * 60 * 1000,
  co2: 15 * 60 * 1000,
  voc: 15 * 60 * 1000,
  noise: 15 * 60 * 1000,
  battery: 2 * 60 * 60 * 1000, // 2 h — battery reports are sparse
  setpoint: 60 * 60 * 1000, // 1 h
  pool_water_temperature: 15 * 60 * 1000,
  pool_temperature_setpoint: 60 * 60 * 1000,
};

export const DEFAULT_STREAMING_TIMEOUT_MS = 15 * 60 * 1000;

// ============================================================
// Energy capacity arbiter (spec 140)
// ============================================================

/**
 * Default load class per equipment type (FR-1). Sowel knows its equipments,
 * so the class is derived and the user only corrects the exceptions. `null`
 * means no obvious energy semantics — the form requires an explicit choice.
 * A form default only: the stored profile always carries the resolved class.
 */
export function defaultEnergyClassFor(type: EquipmentType): EnergyLoadClass | null {
  switch (type) {
    case "water_heater":
    case "pool_pump":
    case "pool_heat_pump":
    case "water_valve":
      return "deferrable";
    case "thermostat":
    case "heater":
      return "comfort";
    default:
      return null;
  }
}

/**
 * Default min-on / min-off per equipment type (review decision 15). A relay
 * in front of a resistor restarts for free; a compressor does not. Editable
 * per equipment.
 */
export function defaultEnergyTimingsFor(type: EquipmentType): { minOnS: number; minOffS: number } {
  switch (type) {
    case "water_heater":
      return { minOnS: 300, minOffS: 300 };
    case "pool_heat_pump":
    case "thermostat":
    case "heater":
      return { minOnS: 900, minOffS: 600 };
    default:
      return { minOnS: 900, minOffS: 300 };
  }
}
