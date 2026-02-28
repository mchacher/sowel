import {
  getDevice,
  addDataBinding,
  addOrderBinding,
  removeDataBinding,
  removeOrderBinding,
} from "../../api";
import type { DataBindingWithValue, OrderBindingWithDetails } from "../../types";

/** Maps equipment types to relevant data categories for auto-binding. */
const RELEVANT_DATA: Record<string, string[]> = {
  light_onoff: ["light_state"],
  light_dimmable: ["light_state", "light_brightness"],
  light_color: ["light_state", "light_brightness", "light_color", "light_color_temp"],
  shutter: ["shutter_position"],
  switch: ["light_state"],
  sensor: ["temperature", "humidity", "pressure", "luminosity", "co2", "voc", "noise", "motion", "contact_door", "contact_window", "water_leak", "smoke", "battery"],
  button: ["action", "battery"],
  thermostat: ["temperature", "generic"],
  weather: ["temperature", "humidity", "pressure", "wind", "rain", "noise", "battery"],
  gate: ["generic"],
};

/** Maps equipment types to relevant order keys for auto-binding. */
const RELEVANT_ORDERS: Record<string, string[]> = {
  light_onoff: ["state", "on"],
  light_dimmable: ["state", "on", "brightness"],
  light_color: ["state", "on", "brightness", "color", "color_temp"],
  shutter: ["position", "state", "target_position"],
  switch: ["state", "on"],
  button: [],
  thermostat: ["power", "operationMode", "targetTemperature", "fanSpeed", "airSwingUD", "airSwingLR", "ecoMode", "nanoe", "profile", "resetAlarm"],
  weather: [],
  gate: ["R1", "R2", "R3", "R4"],
};

/**
 * Maps device data/order keys to standardized equipment aliases.
 * Integrations expose protocol-specific keys (e.g., "targetTemperature"),
 * but the equipment model provides a strict, integration-agnostic contract
 * (e.g., "setpoint"). Recipes and scenarios depend on these standard aliases.
 */
const STANDARD_ALIASES: Record<string, Record<string, string>> = {
  thermostat: {
    targetTemperature: "setpoint",
    insideTemperature: "temperature",
  },
  gate: {
    R1: "toggle",
    R2: "toggle",
    R3: "toggle",
    R4: "toggle",
  },
};

/** Resolve a device key to the standardized equipment alias for the given type. */
export function resolveAlias(key: string, equipmentType: string): string {
  return STANDARD_ALIASES[equipmentType]?.[key] ?? key;
}

export function isRelevantData(category: string, equipmentType: string): boolean {
  return RELEVANT_DATA[equipmentType]?.includes(category) ?? false;
}

export function isRelevantOrder(key: string, equipmentType: string): boolean {
  return RELEVANT_ORDERS[equipmentType]?.includes(key) ?? false;
}

/** Auto-create DataBindings and OrderBindings for selected devices. */
export async function autoCreateBindings(
  equipmentId: string,
  deviceIds: string[],
  equipmentType: string,
): Promise<void> {
  const usedDataAliases = new Set<string>();
  const usedOrderAliases = new Set<string>();

  for (const deviceId of deviceIds) {
    try {
      const device = await getDevice(deviceId);

      for (const data of device.data) {
        if (isRelevantData(data.category, equipmentType)) {
          const alias = uniqueAlias(resolveAlias(data.key, equipmentType), usedDataAliases);
          try {
            await addDataBinding(equipmentId, { deviceDataId: data.id, alias });
            usedDataAliases.add(alias);
          } catch {
            // Alias conflict — skip
          }
        }
      }

      for (const order of device.orders) {
        if (isRelevantOrder(order.key, equipmentType)) {
          const alias = uniqueAlias(resolveAlias(order.key, equipmentType), usedOrderAliases);
          try {
            await addOrderBinding(equipmentId, { deviceOrderId: order.id, alias });
            usedOrderAliases.add(alias);
          } catch {
            // Already bound — skip
          }
        }
      }
    } catch {
      // Skip failed device
    }
  }
}

/** Return a unique alias: "battery", "battery_2", "battery_3", etc. */
function uniqueAlias(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Remove all existing bindings from an equipment. */
export async function removeAllBindings(
  equipmentId: string,
  dataBindings: DataBindingWithValue[],
  orderBindings: OrderBindingWithDetails[],
): Promise<void> {
  for (const b of dataBindings) {
    try {
      await removeDataBinding(equipmentId, b.id);
    } catch {
      // Skip
    }
  }
  for (const b of orderBindings) {
    try {
      await removeOrderBinding(equipmentId, b.id);
    } catch {
      // Skip
    }
  }
}
