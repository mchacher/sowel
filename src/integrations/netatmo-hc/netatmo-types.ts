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
    data.push({ key: "sum_energy_elec", type: "number", category: "energy", unit: "Wh" });
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
