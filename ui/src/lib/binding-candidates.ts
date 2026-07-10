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
import { METERING_CATEGORIES } from "./metering";

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
  return order.enumValues.every((v) => typeof v === "string" && ONOFF_TOKENS.has(v.toUpperCase()));
}

/** Order categories that denote a binary power/on-off command channel. */
const POWER_TOGGLE_CATEGORIES = new Set<string>(["light_toggle", "toggle_power"]);

/**
 * True for an on/off command channel: an ON/OFF enum order (Tasmota `power1`)
 * or a boolean power-toggle order (Zigbee2MQTT plug/relay `state`). Boolean
 * orders of any other category (config toggles) are excluded.
 */
function isOnOffOrder(order: DeviceOrder): boolean {
  if (isOnOffEnum(order)) return true;
  return (
    order.type === "boolean" && !!order.category && POWER_TOGGLE_CATEGORIES.has(order.category)
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
    case "switch": {
      // On/off channel: ON/OFF enum OR boolean power-toggle (Zigbee `state`).
      const candidates: BindingCandidate[] = [];
      for (const o of deviceOrders) {
        if (!isOnOffOrder(o)) continue;
        const matchingData = deviceData.find((d) => d.key === o.key);
        candidates.push({
          id: o.key,
          label: o.key,
          dataKeys: matchingData ? [matchingData.key] : [],
          orderKeys: [o.key],
        });
      }
      // Metering plug (spec 129): a single-channel switch also binds
      // power/energy/voltage/current so it surfaces live power + energy. Bare
      // relay unchanged; multi-gang plugs keep basic per-channel switches.
      if (candidates.length === 1) {
        const meteringKeys = deviceData
          .filter((d) => METERING_CATEGORIES.has(d.category))
          .map((d) => d.key)
          .filter((k) => !candidates[0].dataKeys.includes(k));
        candidates[0].dataKeys.push(...meteringKeys);
      }
      return candidates;
    }

    case "pool_pump":
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
    case "awning":
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

    case "solar_panel": {
      // One candidate per inverter channel (key prefix `ch<N>_`), each grouping
      // that channel's metrics plus the shared `inverter_temp`. Mirror of the
      // backend solar_panel case.
      const sharedTemp = deviceData.find((d) => d.key === "inverter_temp")?.key;
      const byChannel = new Map<number, string[]>();
      for (const d of deviceData) {
        const m = /^ch(\d+)_/.exec(d.key);
        if (!m) continue;
        const n = Number(m[1]);
        if (!byChannel.has(n)) byChannel.set(n, []);
        byChannel.get(n)!.push(d.key);
      }
      return [...byChannel.entries()]
        .sort(([a], [b]) => a - b)
        .map(([n, keys]) => ({
          id: `ch${n}`,
          label: `Panel ${n}`,
          dataKeys: sharedTemp ? [...keys, sharedTemp] : keys,
          orderKeys: [],
        }));
    }

    default:
      return [];
  }
}
