import type { DataCategory, DataType } from "./types.js";

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
