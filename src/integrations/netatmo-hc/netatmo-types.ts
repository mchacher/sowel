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
  bridge?: string;
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
  power?: number;
  sum_energy_elec?: number;
  reachable?: boolean;
}

export interface NetatmoGetMeasureResponse {
  body: Record<string, (number | null)[]>;
  status: string;
}

// ============================================================
// Module type classification (energy meters only)
// ============================================================

/** Energy meter module types */
export const METER_TYPES = new Set([
  "NLPC", // DIN energy meter
]);

// ============================================================
// Module → DiscoveredDevice mapping (NLPC only)
// ============================================================

interface DataDef {
  key: string;
  type: DataType;
  category: DataCategory;
  unit?: string;
}

export function mapModuleToDiscovered(mod: NetatmoModule, _homeId: string): DiscoveredDevice {
  const data: DataDef[] = [
    { key: "power", type: "number", category: "power", unit: "W" },
    { key: "energy", type: "number", category: "energy", unit: "Wh" },
    { key: "autoconso", type: "number", category: "energy", unit: "Wh" },
    { key: "injection", type: "number", category: "energy", unit: "Wh" },
    { key: "demand_30min", type: "number", category: "power", unit: "W" },
  ];

  return {
    friendlyName: mod.name || mod.id,
    manufacturer: "Legrand",
    model: mod.type,
    data,
    orders: [],
  };
}

/**
 * Extract data payload from a module status response (NLPC meters).
 */
export function extractStatusPayload(mod: NetatmoModuleStatus): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (mod.power !== undefined) payload.power = mod.power;
  if (mod.sum_energy_elec !== undefined) payload.sum_energy_elec = mod.sum_energy_elec;
  return payload;
}
