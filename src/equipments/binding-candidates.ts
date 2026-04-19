/**
 * Binding candidates — computes the distinct "functional channels" a device
 * offers for a given equipment type. A candidate is a logical group of
 * device data/orders that together make up one equipment's worth of bindings.
 *
 * Examples:
 *  - Tasmota 4CH Pro + pool_pump → 1 candidate per enum ON/OFF order (power1..4)
 *  - Tasmota 4CH Pro + pool_cover → 1 candidate (shutter_state + shutter_position)
 *  - Sonoff Mini + switch → 1 candidate (power1)
 *  - Weather station + sensor → 1 candidate with all sensor data
 *
 * Callers use this to decide:
 *  - 1 candidate → auto-bind (preserves legacy UX)
 *  - N candidates → show a picker to the user
 *  - 0 free candidates → hide the device in the selector
 */

import type { DeviceData, DeviceOrder, EquipmentType, OrderCategory } from "../shared/types.js";

export interface BindingCandidate {
  /** Stable id used by the UI picker (e.g. "power1", "shutter1", "all"). */
  id: string;
  /** Human-readable label (e.g. "POMPE (power1)"). */
  label: string;
  /** device_data rows that should be bound as part of this candidate (in discovered order). */
  dataKeys: string[];
  /** device_order rows that should be bound as part of this candidate. */
  orderKeys: string[];
}

/** ON/OFF-like enum values. Matches common vendor conventions. */
const ONOFF_TOKENS = new Set(["ON", "OFF", "TOGGLE"]);
const OPEN_CLOSE_STOP_TOKENS = new Set(["OPEN", "CLOSE", "CLOSED", "STOP"]);

function isOnOffEnum(order: DeviceOrder): boolean {
  if (order.type !== "enum") return false;
  if (!order.enumValues || order.enumValues.length === 0) return false;
  return order.enumValues.every((v) => typeof v === "string" && ONOFF_TOKENS.has(v.toUpperCase()));
}

/**
 * Extract the numeric suffix from a key like "power1" → 1, "shutter_state" → null.
 * Used to group shutter orders that share an index.
 */
function extractShutterGroupKey(key: string): string | null {
  // "shutter_state" and "shutter_position" (single shutter) → group "1"
  // "shutter1_state" and "shutter1_position" → group "1"
  // "shutter2_state" etc. → group "2"
  const indexedMatch = /^shutter(\d+)_(state|position|move)$/.exec(key);
  if (indexedMatch) return indexedMatch[1];
  const unindexedMatch = /^shutter_(state|position|move)$/.exec(key);
  if (unindexedMatch) return "1";
  return null;
}

/**
 * Build binding candidates for an equipment type against a device's data/orders.
 */
export function computeBindingCandidates(
  equipmentType: EquipmentType,
  deviceData: readonly DeviceData[],
  deviceOrders: readonly DeviceOrder[],
): BindingCandidate[] {
  switch (equipmentType) {
    case "pool_pump":
    case "switch":
    case "light_onoff":
    case "water_valve": {
      // One candidate per ON/OFF enum order; attach matching data if same key.
      const candidates: BindingCandidate[] = [];
      for (const o of deviceOrders) {
        if (!isOnOffEnum(o)) continue;
        const matchingData = deviceData.find((d) => d.key === o.key);
        candidates.push({
          id: o.key,
          label: o.key,
          dataKeys: matchingData ? [matchingData.key] : [],
          orderKeys: [o.key],
        });
      }
      return candidates;
    }

    case "pool_cover":
    case "shutter": {
      // Group orders by shutter index (e.g. shutter_state + shutter_position).
      const byGroup = new Map<string, { dataKeys: string[]; orderKeys: string[] }>();
      for (const o of deviceOrders) {
        const g = extractShutterGroupKey(o.key);
        if (!g) continue;
        const entry = byGroup.get(g) ?? { dataKeys: [], orderKeys: [] };
        entry.orderKeys.push(o.key);
        byGroup.set(g, entry);
      }
      for (const d of deviceData) {
        const g = extractShutterGroupKey(d.key);
        if (!g) continue;
        const entry = byGroup.get(g) ?? { dataKeys: [], orderKeys: [] };
        entry.dataKeys.push(d.key);
        byGroup.set(g, entry);
      }
      const candidates: BindingCandidate[] = [];
      for (const [g, entry] of byGroup) {
        if (entry.orderKeys.length === 0) continue;
        candidates.push({
          id: `shutter${g}`,
          label: g === "1" ? "Shutter" : `Shutter ${g}`,
          dataKeys: entry.dataKeys,
          orderKeys: entry.orderKeys,
        });
      }
      return candidates;
    }

    case "light_dimmable":
    case "light_color": {
      // A dimmable/color light candidate = ON/OFF order + attached brightness (and optionally color temp/color).
      const candidates: BindingCandidate[] = [];
      const brightnessOrders = deviceOrders.filter((o) => o.key.includes("brightness"));
      const colorTempOrders = deviceOrders.filter(
        (o) => o.key.includes("color_temp") || o.key.includes("color_temperature"),
      );
      const colorOrders = deviceOrders.filter(
        (o) => o.key === "color" || (o.key.includes("color_") && !colorTempOrders.includes(o)),
      );
      for (const o of deviceOrders) {
        if (!isOnOffEnum(o)) continue;
        const dataKeys: string[] = [];
        const orderKeys = [o.key];
        const matchingData = deviceData.find((d) => d.key === o.key);
        if (matchingData) dataKeys.push(matchingData.key);
        for (const b of brightnessOrders) {
          orderKeys.push(b.key);
          const bd = deviceData.find((d) => d.key === b.key);
          if (bd) dataKeys.push(bd.key);
        }
        if (equipmentType === "light_color") {
          for (const ct of colorTempOrders) orderKeys.push(ct.key);
          for (const c of colorOrders) orderKeys.push(c.key);
        }
        candidates.push({ id: o.key, label: o.key, dataKeys, orderKeys });
      }
      return candidates;
    }

    case "sensor":
    case "weather":
    case "weather_forecast":
    case "energy_meter":
    case "main_energy_meter":
    case "energy_production_meter":
    case "button":
    case "appliance":
    case "media_player": {
      // Multi-value equipment: single candidate that groups everything.
      if (deviceData.length === 0 && deviceOrders.length === 0) return [];
      return [
        {
          id: "all",
          label: "All data/orders",
          dataKeys: deviceData.map((d) => d.key),
          orderKeys: deviceOrders.map((o) => o.key),
        },
      ];
    }

    case "thermostat":
    case "heater": {
      // Single candidate grouping everything (power/setpoint/temperature).
      if (deviceData.length === 0 && deviceOrders.length === 0) return [];
      return [
        {
          id: "all",
          label: "All thermostat data/orders",
          dataKeys: deviceData.map((d) => d.key),
          orderKeys: deviceOrders.map((o) => o.key),
        },
      ];
    }

    case "gate": {
      // One candidate per gate-trigger-like order.
      const candidates: BindingCandidate[] = [];
      for (const o of deviceOrders) {
        candidates.push({
          id: o.key,
          label: o.key,
          dataKeys: deviceData.filter((d) => d.key === o.key).map((d) => d.key),
          orderKeys: [o.key],
        });
      }
      if (candidates.length === 0 && deviceData.length > 0) {
        candidates.push({
          id: "all",
          label: "All gate data",
          dataKeys: deviceData.map((d) => d.key),
          orderKeys: [],
        });
      }
      return candidates;
    }

    default: {
      // Fallback: single "all" candidate.
      if (deviceData.length === 0 && deviceOrders.length === 0) return [];
      return [
        {
          id: "all",
          label: "All data/orders",
          dataKeys: deviceData.map((d) => d.key),
          orderKeys: deviceOrders.map((o) => o.key),
        },
      ];
    }
  }
}

/**
 * Returns true when the given device exposes at least one binding candidate
 * for the equipment type whose order keys are not yet consumed by an existing
 * binding. Used by the UI to hide devices that have nothing left to offer.
 *
 * `boundOrderKeysOnDevice` is the set of device_order keys (NOT ids) currently
 * bound on the device — typically derived from joining `order_bindings` with
 * `device_orders` by deviceId.
 */
export function hasFreeCandidates(
  equipmentType: EquipmentType,
  deviceData: readonly DeviceData[],
  deviceOrders: readonly DeviceOrder[],
  boundOrderKeysOnDevice: ReadonlySet<string>,
): boolean {
  const candidates = computeBindingCandidates(equipmentType, deviceData, deviceOrders);
  if (candidates.length === 0) return false;
  return candidates.some((c) => {
    if (c.orderKeys.length === 0) {
      // Pure-data candidate (e.g. sensor): treat as free unless every dataKey is
      // implicitly already used. We don't track data-bound state here because
      // re-binding the same data alias is allowed for sensors. Return true.
      return true;
    }
    return c.orderKeys.some((k) => !boundOrderKeysOnDevice.has(k));
  });
}

/**
 * Infer a per-binding category override for an order bound to a given equipment type.
 * Returns null when no override should be applied (the device_order.category is used as-is).
 */
export function inferBindingCategory(
  equipmentType: EquipmentType,
  order: Pick<DeviceOrder, "type" | "enumValues" | "min" | "max">,
): OrderCategory | null {
  if (equipmentType === "pool_pump") {
    if (
      order.type === "enum" &&
      order.enumValues &&
      order.enumValues.every((v) => typeof v === "string" && ONOFF_TOKENS.has(v.toUpperCase()))
    ) {
      return "pool_pump_toggle";
    }
    return null;
  }

  if (equipmentType === "pool_cover") {
    if (order.type === "enum" && order.enumValues) {
      const upper = order.enumValues
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.toUpperCase());
      if (upper.some((v) => OPEN_CLOSE_STOP_TOKENS.has(v)) && upper.includes("OPEN")) {
        return "pool_cover_move";
      }
    }
    if (order.type === "number") {
      return "pool_cover_position";
    }
    return null;
  }

  return null;
}
