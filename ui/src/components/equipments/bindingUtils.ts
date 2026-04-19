import {
  getDevice,
  addDataBinding,
  addOrderBinding,
  removeDataBinding,
  removeOrderBinding,
} from "../../api";
import type {
  DataBindingWithValue,
  EquipmentType,
  OrderBindingWithDetails,
} from "../../types";
import { computeBindingCandidates } from "../../lib/binding-candidates";

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
  gate: ["generic", "contact_door"],
  heater: ["generic", "light_state"],
  energy_meter: ["energy", "power"],
  main_energy_meter: ["energy", "power"],
  energy_production_meter: ["energy", "power"],
  media_player: ["generic"],
  appliance: ["generic", "energy"],
  water_valve: ["light_state", "battery", "generic"],
  // Accept both the spec-correct Sowel categories and the legacy Tasmota
  // categories (generic for relays, position for shutter) so users on older
  // plugin versions still get auto-bindings.
  pool_pump: ["light_state", "generic"],
  pool_cover: ["shutter_position", "position", "generic"],
};

/** Maps equipment types to relevant order keys for auto-binding. */
const RELEVANT_ORDERS: Record<string, string[]> = {
  light_onoff: ["state", "on", "R1", "R2", "R3", "R4"],
  light_dimmable: ["state", "on", "brightness", "R1", "R2", "R3", "R4"],
  light_color: ["state", "on", "brightness", "color", "color_temp", "R1", "R2", "R3", "R4"],
  shutter: ["position", "state", "target_position"],
  switch: ["state", "on", "R1", "R2", "R3", "R4"],
  button: [],
  thermostat: ["power", "operationMode", "targetTemperature", "fanSpeed", "airSwingUD", "airSwingLR", "ecoMode", "nanoe", "profile", "resetAlarm"],
  weather: [],
  gate: ["R1", "R2", "R3", "R4", "command"],
  heater: ["state", "on", "R1", "R2", "R3", "R4"],
  energy_meter: [],
  main_energy_meter: [],
  energy_production_meter: [],
  media_player: ["power", "input_source"],
  appliance: [],
  water_valve: [
    "state",
    "irrigation_duration",
    "irrigation_interval",
    "irrigation_capacity",
    "total_number",
    "auto_close_when_water_shortage",
  ],
  pool_pump: [
    "state",
    "on",
    "R1",
    "R2",
    "R3",
    "R4",
    "power1",
    "power2",
    "power3",
    "power4",
  ],
  pool_cover: [
    "state",
    "position",
    "target_position",
    "shutter_state",
    "shutter_position",
    "shutter1_state",
    "shutter1_position",
    "shutter2_state",
    "shutter2_position",
  ],
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
    R1: "command",
    R2: "command",
    R3: "command",
    R4: "command",
  },
  light_onoff: {
    R1: "state",
    R2: "state",
    R3: "state",
    R4: "state",
  },
  light_dimmable: {
    R1: "state",
    R2: "state",
    R3: "state",
    R4: "state",
  },
  light_color: {
    R1: "state",
    R2: "state",
    R3: "state",
    R4: "state",
  },
  switch: {
    R1: "state",
    R2: "state",
    R3: "state",
    R4: "state",
  },
  heater: {
    R1: "state",
    R2: "state",
    R3: "state",
    R4: "state",
  },
  water_valve: {
    // Data keys → standard aliases
    current_device_status: "status",
    // Order keys → standard aliases
    irrigation_duration: "duration",
    irrigation_interval: "interval",
    irrigation_capacity: "capacity",
    total_number: "cycles",
    auto_close_when_water_shortage: "autoCloseOnShortage",
  },
  pool_pump: {
    power1: "state",
    power2: "state",
    power3: "state",
    power4: "state",
    R1: "state",
    R2: "state",
    R3: "state",
    R4: "state",
  },
  pool_cover: {
    shutter_state: "state",
    shutter1_state: "state",
    shutter2_state: "state",
    shutter_position: "position",
    shutter1_position: "position",
    shutter2_position: "position",
    target_position: "position",
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

/** Equipment types whose bindings are spec'd as structured candidates
 * (see src/equipments/binding-candidates.ts). For these, we pick the first
 * candidate and bind exactly its data/order keys — no more, no less. */
const CANDIDATE_BASED_TYPES: ReadonlySet<EquipmentType> = new Set<EquipmentType>([
  "pool_pump",
  "pool_cover",
]);

/** Auto-create DataBindings and OrderBindings for selected devices. */
export async function autoCreateBindings(
  equipmentId: string,
  deviceIds: string[],
  equipmentType: string,
): Promise<void> {
  const usedDataAliases = new Set<string>();
  const usedOrderAliases = new Set<string>();
  const useCandidates = CANDIDATE_BASED_TYPES.has(equipmentType as EquipmentType);

  for (const deviceId of deviceIds) {
    try {
      const device = await getDevice(deviceId);

      // Candidate-based binding: compute the functional channels the device
      // offers for this equipment type and bind only the first candidate's
      // data/orders. Guarantees spec-conformant bindings (no cross-channel
      // pollution on multi-relay devices like Tasmota 4CH Pro).
      if (useCandidates) {
        const candidates = computeBindingCandidates(
          equipmentType as EquipmentType,
          device.data,
          device.orders,
        );
        if (candidates.length === 0) {
          // No matching channel on this device — skip silently
          continue;
        }
        // Pick the first candidate deterministically. Multi-candidate picker
        // UX is a follow-up; users can edit bindings afterwards.
        const chosen = candidates[0];
        const allowedData = new Set(chosen.dataKeys);
        const allowedOrders = new Set(chosen.orderKeys);

        for (const data of device.data) {
          if (!allowedData.has(data.key)) continue;
          const alias = uniqueAlias(resolveAlias(data.key, equipmentType), usedDataAliases);
          try {
            await addDataBinding(equipmentId, { deviceDataId: data.id, alias });
            usedDataAliases.add(alias);
          } catch {
            // Alias conflict — skip
          }
        }
        for (const order of device.orders) {
          if (!allowedOrders.has(order.key)) continue;
          const alias = uniqueAlias(resolveAlias(order.key, equipmentType), usedOrderAliases);
          try {
            await addOrderBinding(equipmentId, { deviceOrderId: order.id, alias });
            usedOrderAliases.add(alias);
          } catch {
            // Already bound — skip
          }
        }
        continue;
      }

      // Legacy path for all other equipment types — bind everything that
      // matches the RELEVANT_DATA / RELEVANT_ORDERS whitelists.
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
