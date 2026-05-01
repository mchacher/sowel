/**
 * Binding candidates (frontend mirror of src/equipments/binding-candidates.ts).
 *
 * A candidate is a logical group of device data/orders that together make up
 * one equipment's worth of bindings. The UI uses this to:
 *  - auto-bind when a device yields 1 candidate
 *  - (future) show a picker when a device yields N candidates
 *
 * Keep in sync with the backend version — tests live there.
 */

import type { DeviceData, DeviceOrder, EquipmentType } from "../types";

export interface BindingCandidate {
  id: string;
  label: string;
  dataKeys: string[];
  orderKeys: string[];
}

const ONOFF_TOKENS = new Set(["ON", "OFF", "TOGGLE"]);

function isOnOffEnum(order: DeviceOrder): boolean {
  if (order.type !== "enum") return false;
  if (!order.enumValues || order.enumValues.length === 0) return false;
  return order.enumValues.every(
    (v) => typeof v === "string" && ONOFF_TOKENS.has(v.toUpperCase()),
  );
}

function extractShutterGroupKey(key: string): string | null {
  const indexed = /^shutter(\d+)_(state|position|move)$/.exec(key);
  if (indexed) return indexed[1];
  const unindexed = /^shutter_(state|position|move)$/.exec(key);
  if (unindexed) return "1";
  return null;
}

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

    case "pool_heat_pump": {
      // Hybrid: PAC device (exposing pool_water_temperature) → single "all"
      // candidate. ON/OFF relay device → one candidate per channel.
      const isPac = deviceData.some((d) => d.category === "pool_water_temperature");
      if (isPac) {
        if (deviceData.length === 0 && deviceOrders.length === 0) return [];
        return [
          {
            id: "all",
            label: "All PAC data/orders",
            dataKeys: deviceData.map((d) => d.key),
            orderKeys: deviceOrders.map((o) => o.key),
          },
        ];
      }
      // Read-only: pool_heat_pump observes the relay for its filtration_state
      // alias, no order claim (pool_pump owns the actual write).
      const candidates: BindingCandidate[] = [];
      for (const o of deviceOrders) {
        if (!isOnOffEnum(o)) continue;
        const matchingData = deviceData.find((d) => d.key === o.key);
        if (!matchingData) continue;
        candidates.push({
          id: o.key,
          label: o.key,
          dataKeys: [matchingData.key],
          orderKeys: [],
        });
      }
      return candidates;
    }

    default:
      return [];
  }
}
