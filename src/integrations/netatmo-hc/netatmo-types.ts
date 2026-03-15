import type { DataType, DataCategory } from "../../shared/types.js";
import type { DiscoveredDevice } from "../../devices/device-manager.js";

// ============================================================
// Netatmo API response types
// ============================================================

export interface NetatmoTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
}

export interface NetatmoHomesDataResponse {
  body: {
    homes: NetatmoHome[];
  };
  status: string;
}

export interface NetatmoHome {
  id: string;
  name: string;
  modules: NetatmoModule[];
}

export interface NetatmoModule {
  id: string;
  type: string;
  name: string;
  bridge?: string; // gateway module ID
  room_id?: string;
}

export interface NetatmoHomeStatusResponse {
  body: {
    home: {
      id: string;
      modules: NetatmoModuleStatus[];
    };
  };
  status: string;
}

export interface NetatmoModuleStatus {
  id: string;
  type: string;
  // Switch / contactor / teleruptor
  on?: boolean;
  // Dimmer
  brightness?: number;
  // Shutter
  current_position?: number;
  target_position?: number;
  // Energy meter
  power?: number;
  sum_energy_elec?: number;
  // Gateway
  wifi_strength?: number;
  // Common
  reachable?: boolean;
  firmware_revision?: number;
}

export interface NetatmoGetMeasureResponse {
  body: Record<string, (number | null)[]>;
  status: string;
}

export interface NetatmoSetStateRequest {
  home: {
    id: string;
    modules: Array<Record<string, unknown>>;
  };
}

// ============================================================
// Weather Station types (getstationsdata)
// ============================================================

export interface NetatmoStationsDataResponse {
  body: {
    devices: NetatmoStationDevice[];
  };
  status: string;
}

export interface NetatmoStationDevice {
  _id: string;
  type: string; // "NAMain"
  station_name: string;
  module_name: string;
  firmware: number;
  wifi_status: number;
  dashboard_data: NetatmoStationDashboard;
  modules?: NetatmoStationModule[];
}

export interface NetatmoStationModule {
  _id: string;
  type: string; // "NAModule1" | "NAModule2" | "NAModule3" | "NAModule4"
  module_name: string;
  firmware: number;
  rf_status: number;
  battery_percent: number;
  battery_vp: number;
  dashboard_data?: NetatmoStationDashboard;
}

export interface NetatmoStationDashboard {
  // NAMain (indoor)
  Temperature?: number;
  Humidity?: number;
  CO2?: number;
  Noise?: number;
  Pressure?: number;
  AbsolutePressure?: number;
  // NAModule1 (outdoor)
  min_temp?: number;
  max_temp?: number;
  // NAModule2 (wind)
  WindStrength?: number;
  WindAngle?: number;
  GustStrength?: number;
  GustAngle?: number;
  // NAModule3 (rain)
  Rain?: number;
  sum_rain_1?: number;
  sum_rain_24?: number;
  // Common
  time_utc?: number;
}

// ============================================================
// Module type classification
// ============================================================

/** Module types that support on/off commands */
const SWITCHABLE_TYPES = new Set([
  "NLPT", // Teleruptor
  "NLPO", // Contactor
  "NLL", // Light switch with neutral
  "NLIS", // Double switch with neutral
  "NLP", // Power outlet
  "NLPM", // Mobile socket
  "NLPD", // Dry contact
  "NLC", // Cable outlet
]);

/** Module types that are dimmers */
const DIMMER_TYPES = new Set([
  "NLF", // Dimmer switch
  "NLFE", // Dimmer switch evolution
  "NLFN", // Dimmer with neutral
]);

/** Module types that are shutters */
const SHUTTER_TYPES = new Set([
  "NLV", // Roller shutter switch
  "NLLV", // Roller shutter with level
  "NLIV", // 1/2 gangs shutter
]);

/** Module types that are energy meters */
export const METER_TYPES = new Set([
  "NLPC", // DIN energy meter
  "NLE", // Ecometer
]);

/** Module types that are gateways (data only) */
const GATEWAY_TYPES = new Set([
  "NLG", // Gateway
  "NLGS", // Standard DIN gateway
]);

/** Weather station module types */
export const WEATHER_TYPES = new Set([
  "NAMain", // Indoor station (base)
  "NAModule1", // Outdoor module (temp + humidity)
  "NAModule2", // Wind gauge
  "NAModule3", // Rain gauge
  "NAModule4", // Additional indoor module
]);

export function isSupportedModule(type: string): boolean {
  return (
    SWITCHABLE_TYPES.has(type) ||
    DIMMER_TYPES.has(type) ||
    SHUTTER_TYPES.has(type) ||
    METER_TYPES.has(type) ||
    GATEWAY_TYPES.has(type)
  );
}

// ============================================================
// Module → DiscoveredDevice mapping
// ============================================================

interface DataDef {
  key: string;
  type: DataType;
  category: DataCategory;
  unit?: string;
}

interface OrderDef {
  key: string;
  type: DataType;
  dispatchConfig: Record<string, unknown>;
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}

export function mapModuleToDiscovered(mod: NetatmoModule, homeId: string): DiscoveredDevice {
  const data: DataDef[] = [];
  const orders: OrderDef[] = [];
  const dc = (param: string) => ({
    homeId,
    moduleId: mod.id,
    param,
    ...(mod.bridge ? { bridge: mod.bridge } : {}),
  });

  if (SWITCHABLE_TYPES.has(mod.type)) {
    data.push({ key: "on", type: "boolean", category: "light_state" });
    orders.push({ key: "on", type: "boolean", dispatchConfig: dc("on") });
  } else if (DIMMER_TYPES.has(mod.type)) {
    data.push({ key: "on", type: "boolean", category: "light_state" });
    data.push({ key: "brightness", type: "number", category: "light_brightness", unit: "%" });
    orders.push({ key: "on", type: "boolean", dispatchConfig: dc("on") });
    orders.push({
      key: "brightness",
      type: "number",
      dispatchConfig: dc("brightness"),
      min: 0,
      max: 100,
      unit: "%",
    });
  } else if (SHUTTER_TYPES.has(mod.type)) {
    data.push({ key: "current_position", type: "number", category: "shutter_position", unit: "%" });
    orders.push({
      key: "target_position",
      type: "number",
      dispatchConfig: dc("target_position"),
      min: 0,
      max: 100,
      unit: "%",
    });
  } else if (METER_TYPES.has(mod.type)) {
    data.push({ key: "power", type: "number", category: "power", unit: "W" });
    data.push({ key: "energy", type: "number", category: "energy", unit: "Wh" });
    data.push({ key: "autoconso", type: "number", category: "energy", unit: "Wh" });
    data.push({ key: "injection", type: "number", category: "energy", unit: "Wh" });
    data.push({ key: "demand_30min", type: "number", category: "power", unit: "W" });
  } else if (GATEWAY_TYPES.has(mod.type)) {
    data.push({ key: "wifi_strength", type: "number", category: "generic" });
  }

  return {
    friendlyName: mod.name || mod.id,
    manufacturer: "Legrand",
    model: mod.type,
    data,
    orders,
  };
}

// ============================================================
// Weather Station → DiscoveredDevice mapping
// ============================================================

const WEATHER_MODEL_NAMES: Record<string, string> = {
  NAMain: "Indoor Station",
  NAModule1: "Outdoor Module",
  NAModule2: "Wind Gauge",
  NAModule3: "Rain Gauge",
  NAModule4: "Indoor Module",
};

export function mapWeatherStationToDiscovered(device: NetatmoStationDevice): DiscoveredDevice {
  const data: DataDef[] = [
    { key: "temperature", type: "number", category: "temperature", unit: "°C" },
    { key: "humidity", type: "number", category: "humidity", unit: "%" },
    { key: "co2", type: "number", category: "co2", unit: "ppm" },
    { key: "noise", type: "number", category: "noise", unit: "dB" },
    { key: "pressure", type: "number", category: "pressure", unit: "mbar" },
  ];

  return {
    friendlyName: device.module_name || device.station_name,
    manufacturer: "Netatmo",
    model: WEATHER_MODEL_NAMES[device.type] ?? device.type,
    data,
    orders: [],
  };
}

export function mapWeatherModuleToDiscovered(mod: NetatmoStationModule): DiscoveredDevice {
  const data: DataDef[] = [];

  // All sub-modules have battery
  data.push({ key: "battery", type: "number", category: "battery", unit: "%" });

  switch (mod.type) {
    case "NAModule1": // Outdoor: temp + humidity
      data.push({ key: "temperature", type: "number", category: "temperature", unit: "°C" });
      data.push({ key: "humidity", type: "number", category: "humidity", unit: "%" });
      break;
    case "NAModule2": // Wind
      data.push({ key: "wind_strength", type: "number", category: "wind", unit: "km/h" });
      data.push({ key: "wind_angle", type: "number", category: "wind", unit: "°" });
      data.push({ key: "gust_strength", type: "number", category: "wind", unit: "km/h" });
      data.push({ key: "gust_angle", type: "number", category: "wind", unit: "°" });
      break;
    case "NAModule3": // Rain
      data.push({ key: "rain", type: "number", category: "rain", unit: "mm" });
      data.push({ key: "sum_rain_1", type: "number", category: "rain", unit: "mm" });
      data.push({ key: "sum_rain_24", type: "number", category: "rain", unit: "mm" });
      break;
    case "NAModule4": // Additional indoor: temp + humidity + CO2
      data.push({ key: "temperature", type: "number", category: "temperature", unit: "°C" });
      data.push({ key: "humidity", type: "number", category: "humidity", unit: "%" });
      data.push({ key: "co2", type: "number", category: "co2", unit: "ppm" });
      break;
  }

  return {
    friendlyName: mod.module_name || mod._id,
    manufacturer: "Netatmo",
    model: WEATHER_MODEL_NAMES[mod.type] ?? mod.type,
    data,
    orders: [],
  };
}

/**
 * Extract data payload from weather station dashboard_data.
 */
export function extractWeatherPayload(
  dashboard: NetatmoStationDashboard,
  moduleType: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  switch (moduleType) {
    case "NAMain":
      if (dashboard.Temperature !== undefined) payload.temperature = dashboard.Temperature;
      if (dashboard.Humidity !== undefined) payload.humidity = dashboard.Humidity;
      if (dashboard.CO2 !== undefined) payload.co2 = dashboard.CO2;
      if (dashboard.Noise !== undefined) payload.noise = dashboard.Noise;
      if (dashboard.Pressure !== undefined) payload.pressure = dashboard.Pressure;
      break;
    case "NAModule1":
      if (dashboard.Temperature !== undefined) payload.temperature = dashboard.Temperature;
      if (dashboard.Humidity !== undefined) payload.humidity = dashboard.Humidity;
      break;
    case "NAModule2":
      if (dashboard.WindStrength !== undefined) payload.wind_strength = dashboard.WindStrength;
      if (dashboard.WindAngle !== undefined) payload.wind_angle = dashboard.WindAngle;
      if (dashboard.GustStrength !== undefined) payload.gust_strength = dashboard.GustStrength;
      if (dashboard.GustAngle !== undefined) payload.gust_angle = dashboard.GustAngle;
      break;
    case "NAModule3":
      if (dashboard.Rain !== undefined) payload.rain = dashboard.Rain;
      if (dashboard.sum_rain_1 !== undefined) payload.sum_rain_1 = dashboard.sum_rain_1;
      if (dashboard.sum_rain_24 !== undefined) payload.sum_rain_24 = dashboard.sum_rain_24;
      break;
    case "NAModule4":
      if (dashboard.Temperature !== undefined) payload.temperature = dashboard.Temperature;
      if (dashboard.Humidity !== undefined) payload.humidity = dashboard.Humidity;
      if (dashboard.CO2 !== undefined) payload.co2 = dashboard.CO2;
      break;
  }

  return payload;
}

/**
 * Extract data payload from a module status response.
 * Returns a Record<string, unknown> suitable for DeviceManager.updateDeviceData().
 */
export function extractStatusPayload(mod: NetatmoModuleStatus): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (mod.on !== undefined) payload.on = mod.on;
  if (mod.brightness !== undefined) payload.brightness = mod.brightness;
  if (mod.current_position !== undefined) payload.current_position = mod.current_position;
  if (mod.power !== undefined) payload.power = mod.power;
  if (mod.sum_energy_elec !== undefined) payload.sum_energy_elec = mod.sum_energy_elec;
  if (mod.wifi_strength !== undefined) payload.wifi_strength = mod.wifi_strength;

  return payload;
}
