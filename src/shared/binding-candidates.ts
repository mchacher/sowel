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
 *
 * Spec 150 — this is THE single implementation, shared by the backend and the
 * UI (ui/src/lib/binding-candidates.ts re-exports it). It previously existed
 * as two hand-synced copies that diverged: the UI copy was missing several
 * equipment types (light_dimmable/light_color among others), silently hiding
 * compatible devices. Input types are structural on purpose so backend and UI
 * callers can pass their own DeviceData/DeviceOrder shapes.
 */

import type { DataCategory, DataType, EquipmentType, OrderCategory } from "./types.js";
import { METERING_CATEGORIES } from "./constants.js";

/** Structural subset of a device_data row this module needs. */
export interface CandidateData {
  key: string;
  category: DataCategory;
}

/** Structural subset of a device_order row this module needs. */
export interface CandidateOrder {
  key: string;
  type: DataType;
  category?: OrderCategory | null;
  enumValues?: string[] | null;
  min?: number | null;
  max?: number | null;
}

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

/**
 * Equipment types whose device compatibility and auto-binding are driven by
 * computeBindingCandidates (vs the legacy key/category whitelists). Single
 * source of truth — previously duplicated in DeviceSelector.tsx and
 * bindingUtils.ts. `water_valve` is intentionally key-driven, NOT
 * candidate-based: it must bind its full surface (state + flow + battery +
 * irrigation), not just the relay channel.
 */
export const CANDIDATE_BASED_TYPES: ReadonlySet<EquipmentType> = new Set<EquipmentType>([
  "pool_pump",
  "pool_cover",
  "pool_heat_pump",
  "light_onoff",
  "light_dimmable",
  "light_color",
  "switch",
  "water_heater",
  "shutter",
  "awning",
  "solar_panel",
  // Spec 150 — gate joins the candidate-based types so an on/off relay
  // (Zigbee dry-contact like the SONOFF MINI-ZBD) is offered as a gate
  // command alongside LoRa R1..R4 and Somfy gate_trigger.
  "gate",
  // Spec 153 — a VMC groups up to two on/off relay channels (low + optional
  // high) into a single ventilation equipment.
  "vmc",
]);

/** ON/OFF-like enum values. Matches common vendor conventions. */
const ONOFF_TOKENS = new Set(["ON", "OFF", "TOGGLE"]);
const OPEN_CLOSE_STOP_TOKENS = new Set(["OPEN", "CLOSE", "CLOSED", "STOP"]);

function isOnOffEnum(order: CandidateOrder): boolean {
  if (order.type !== "enum") return false;
  if (!order.enumValues || order.enumValues.length === 0) return false;
  return order.enumValues.every((v) => typeof v === "string" && ONOFF_TOKENS.has(v.toUpperCase()));
}

/** Order categories that denote a binary power/on-off command channel. */
const POWER_TOGGLE_CATEGORIES = new Set<OrderCategory>(["light_toggle", "toggle_power"]);

/**
 * Spec 152 — equipment types that can carry a dedicated "solar" command
 * channel (a second on/off, distinct from the main one, driven by the surplus
 * arbiter recipe). The solar role is bound explicitly under alias `solar`
 * (order) / `solar_state` (state); it is never auto-inferred from the device.
 */
const SOLAR_CHANNEL_TYPES = new Set<EquipmentType>(["water_heater", "switch"]);

/** Reserved alias marking the solar command / state binding role. */
export const SOLAR_ORDER_ALIAS = "solar";
export const SOLAR_STATE_ALIAS = "solar_state";

/**
 * True for an on/off command channel. Two shapes are accepted:
 *  - an ON/OFF enum order (`["ON","OFF"]`, e.g. Tasmota `power1`)
 *  - a boolean power-toggle order (Zigbee2MQTT exposes plug/relay `state` as a
 *    boolean with category `light_toggle`/`toggle_power`)
 * Boolean orders of any other category (config toggles like `power_alarm`,
 * `eco_mode`, …) are intentionally excluded.
 */
function isOnOffOrder(order: CandidateOrder): boolean {
  if (isOnOffEnum(order)) return true;
  return (
    order.type === "boolean" && !!order.category && POWER_TOGGLE_CATEGORIES.has(order.category)
  );
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
 * True for an order that can trigger a gate: an on/off relay channel (Zigbee
 * boolean `state`, Tasmota ON/OFF enum), a LoRa relay channel (R1..R4), or an
 * explicit gate command (`command`/`gate_trigger` key, or `gate_trigger`
 * category e.g. Somfy RTS). Writable config exposes (`power_on_behavior`,
 * `turbo_mode`, …) are NOT triggers.
 */
function isGateTriggerOrder(order: CandidateOrder): boolean {
  if (isOnOffOrder(order)) return true;
  if (/^R[1-4]$/.test(order.key)) return true;
  if (order.key === "command" || order.key === "gate_trigger") return true;
  return order.category === "gate_trigger";
}

/**
 * Gate state feedback rows worth attaching to a gate candidate: LoRa reed
 * switches (key `RS*`, deriveGateState strategy 1) and contact sensors
 * (category contact_door/contact_window, strategy 2).
 */
function gateFeedbackKeys(deviceData: readonly CandidateData[]): string[] {
  return deviceData
    .filter(
      (d) =>
        d.key.startsWith("RS") || d.category === "contact_door" || d.category === "contact_window",
    )
    .map((d) => d.key);
}

/**
 * Build binding candidates for an equipment type against a device's data/orders.
 */
export function computeBindingCandidates(
  equipmentType: EquipmentType,
  deviceData: readonly CandidateData[],
  deviceOrders: readonly CandidateOrder[],
): BindingCandidate[] {
  switch (equipmentType) {
    // Spec 135 — a water heater is an on/off relay with the same candidate
    // shape as a switch (on/off channel + metering attach). Its water
    // temperature is an optional extra binding (often on another device),
    // not a candidate discriminator, so it is not required for compatibility.
    case "water_heater":
    case "switch": {
      // One candidate per on/off command channel: ON/OFF enum (Tasmota `power1`)
      // OR a boolean power-toggle order (Zigbee2MQTT plug/relay `state`).
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
      // Metering plug (spec 129): a single-channel switch also captures its
      // power/energy/voltage/current so it can surface live power + feed the
      // energy history. A bare relay (no metering data) is unchanged. Multi-gang
      // plugs (>1 on/off channel) are left as basic switches — per-channel
      // metering attribution is out of scope.
      if (candidates.length === 1) {
        const meteringKeys = deviceData
          .filter((d) => METERING_CATEGORIES.has(d.category))
          .map((d) => d.key)
          .filter((k) => !candidates[0].dataKeys.includes(k));
        candidates[0].dataKeys.push(...meteringKeys);
      }
      return candidates;
    }

    case "vmc": {
      // Spec 153 — a VMC drives up to two on/off relay channels: `low` (petite
      // vitesse) and `high` (grande vitesse, optional). Unlike `switch` (one
      // candidate per channel), group all on/off channels of the device into
      // ONE candidate so a 2-channel relay (e.g. Sonoff MINI DUO, state_l1/
      // state_l2) binds as a single ventilation equipment. Channels are sorted
      // by key for a deterministic low→high assignment (see autoCreateBindings /
      // createWithAutoBindings, which alias the first channel `low`, second `high`).
      const onOff = deviceOrders
        .filter((o) => isOnOffOrder(o))
        .slice()
        .sort((a, b) => a.key.localeCompare(b.key));
      if (onOff.length === 0) return [];
      const orderKeys = onOff.slice(0, 2).map((o) => o.key);
      const dataKeys = orderKeys
        .map((k) => deviceData.find((d) => d.key === k)?.key)
        .filter((k): k is string => k !== undefined);
      return [{ id: "vmc", label: "Ventilation", dataKeys, orderKeys }];
    }

    case "pool_pump":
    case "light_onoff":
    case "water_valve": {
      // One candidate per on/off command: an ON/OFF enum order (Tasmota
      // `power1`) OR a boolean power-toggle order (Zigbee2MQTT relay/light
      // `state`, category light_toggle/toggle_power) — same rule as `switch`.
      // isOnOffEnum alone silently excluded every Zigbee relay (e.g. Tuya
      // WHD02) from light_onoff/pool_pump (boolean `state`, not enum),
      // though it bound fine to a `switch`.
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
      return candidates;
    }

    case "pool_cover":
    case "awning":
    case "shutter": {
      // Group orders by shutter index (e.g. shutter_state + shutter_position).
      // This key-name convention (Tasmota-style: shutter_state/shutterN_state)
      // is what lets a single physical device expose several independent
      // shutter channels.
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

      // Category-first fallback (mirrors ShutterControl.tsx's own resolver)
      // for integrations that don't use the shutter_*/shutterN_* key naming
      // convention at all — e.g. Legrand/Bubendorff Home+Control
      // (sowel-plugin-legrand-control), whose device exposes
      // current_position / target_position / state. Before this fallback,
      // such a device produced ZERO candidates here, so the "Create
      // equipment" picker had nothing to auto-bind and the equipment was
      // created with no bindings at all (shows as offline — spec 116 has
      // nothing to derive status from). A device using this convention only
      // ever exposes one shutter channel, so everything collapses into a
      // single group instead of being indexed like the Tasmota case above.
      if (byGroup.size === 0) {
        const dataKeys = deviceData
          .filter((d) => d.category === "shutter_position")
          .map((d) => d.key);
        const orderKeys = deviceOrders
          .filter((o) => o.category === "set_shutter_position" || o.category === "shutter_move")
          .map((o) => o.key);
        if (orderKeys.length > 0) {
          byGroup.set("1", { dataKeys, orderKeys });
        }
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
      // A dimmable/color light candidate = on/off order + attached brightness
      // (and optionally color temp/color). Accepts BOTH the ON/OFF enum shape
      // and the Zigbee boolean light_toggle shape — same isOnOffOrder rule as
      // switch/light_onoff (a boolean-state dimmable bulb previously yielded
      // zero candidates here).
      const candidates: BindingCandidate[] = [];
      const brightnessOrders = deviceOrders.filter((o) => o.key.includes("brightness"));
      const colorTempOrders = deviceOrders.filter(
        (o) => o.key.includes("color_temp") || o.key.includes("color_temperature"),
      );
      const colorOrders = deviceOrders.filter(
        (o) => o.key === "color" || (o.key.includes("color_") && !colorTempOrders.includes(o)),
      );
      for (const o of deviceOrders) {
        if (!isOnOffOrder(o)) continue;
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

    case "solar_panel": {
      // One candidate per inverter channel (key prefix `ch<N>_`). Each panel
      // groups that channel's metrics (voltage/current/power/energy) plus the
      // shared inverter temperature `inverter_temp` so both panels of a DS3
      // display the same inverter temperature. Inverter-level keys (total
      // power/energy, ac_voltage, frequency, signal) are intentionally left
      // unbound — they belong to the inverter, not a panel.
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

    case "sensor":
    case "weather":
    case "weather_forecast":
    case "energy_meter":
    case "main_energy_meter":
    case "energy_production_meter":
    case "button":
    case "appliance":
    case "media_player":
    case "display": {
      // Multi-value equipment: single candidate that groups everything.
      // Spec 120 — `display` binds whatever telemetry the plugin exposes
      // (firmware_version / uptime / rssi / language / display_brightness)
      // + matching orders. Polymorphic: missing fields are fine.
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

    case "pool_heat_pump": {
      // Hybrid: PAC device (exposing pool_water_temperature) → single "all" candidate.
      // ON/OFF relay device (e.g. Sonoff 4CH driving filtration) → one candidate per channel
      //   so the user can pick which relay drives the filtration_state alias.
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
      // Read-only binding: pool_heat_pump just listens to the relay state for
      // its `filtration_state` alias. Don't claim the order — it stays
      // available to whichever pool_pump equipment drives the same relay.
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

    case "gate": {
      // Spec 150 — one candidate per trigger-like order (on/off relay channel,
      // LoRa R1..R4, Somfy command/gate_trigger). Each candidate also attaches
      // the device's gate feedback rows (LoRa reed `RS*`, contact sensors) so
      // a combined controller (e.g. LoRa board with R1 relay + RS reed) keeps
      // feeding deriveGateState. Config-only writable exposes are ignored —
      // previously EVERY order became a candidate, and the runtime UI path did
      // not even accept a Zigbee relay `state` order as a gate command.
      // The relay's own `state` feedback data is deliberately NOT bound: the
      // gate's open/closed state is a virtual binding (alias `state`, category
      // gate_state, derived from contact/reed rows), and a light_state data
      // binding on a gate would both collide with that alias and pollute the
      // zone aggregator's lights-on count.
      const feedback = gateFeedbackKeys(deviceData);
      const candidates: BindingCandidate[] = [];
      for (const o of deviceOrders) {
        if (!isGateTriggerOrder(o)) continue;
        candidates.push({
          id: o.key,
          label: o.key,
          dataKeys: [...feedback],
          orderKeys: [o.key],
        });
      }
      // Trigger-less devices stay bindable for state derivation: contact
      // sensors (SNZB-04P) and data-only reed boards (RS*). No blanket
      // "all data" fallback: a device with neither a trigger order nor
      // feedback rows has nothing a gate can use, and offering it would
      // auto-bind unrelated sensor data to the gate.
      if (candidates.length === 0 && feedback.length > 0) {
        candidates.push({
          id: "contact",
          label: "Contact sensor",
          dataKeys: feedback,
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
  deviceData: readonly CandidateData[],
  deviceOrders: readonly CandidateOrder[],
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
  order: Pick<CandidateOrder, "type" | "enumValues" | "min" | "max">,
  alias?: string,
): OrderCategory | null {
  // Spec 152 — an on/off order bound under the reserved `solar` alias becomes
  // the dedicated solar command channel, regardless of the device order's own
  // category (a plain relay reports light_toggle/toggle_power). Guarded to
  // on/off-shaped orders so a setpoint/number can never be tagged solar.
  if (
    alias === SOLAR_ORDER_ALIAS &&
    SOLAR_CHANNEL_TYPES.has(equipmentType) &&
    (order.type === "boolean" || isOnOffEnum(order as CandidateOrder))
  ) {
    return "solar_toggle";
  }

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

/**
 * Spec 152 — infer a per-binding category override for a DATA binding. Mirrors
 * inferBindingCategory for the order side. A state binding added under the
 * reserved `solar_state` alias on a solar-capable equipment is tagged
 * `solar_state` (distinct from the main on/off `light_state`) so the two
 * channels resolve independently and the solar state charts as its own series.
 * Returns null when no override applies (the device_data.category is used).
 */
export function inferDataBindingCategory(
  equipmentType: EquipmentType,
  alias: string,
): DataCategory | null {
  if (alias === SOLAR_STATE_ALIAS && SOLAR_CHANNEL_TYPES.has(equipmentType)) {
    return "solar_state";
  }
  return null;
}
