import {
  getDevice,
  addDataBinding,
  addOrderBinding,
  removeDataBinding,
  removeOrderBinding,
} from "../../api";
import type {
  DataBindingWithValue,
  DataCategory,
  EquipmentType,
  OrderBindingWithDetails,
  OrderCategory,
} from "../../types";
import { computeBindingCandidates } from "../../lib/binding-candidates";

// ============================================================
// Read-side resolvers (category-first, alias fallback)
// ============================================================

/** Minimal binding shape the resolvers need. */
interface MinimalOrderBinding {
  alias: string;
  category?: OrderCategory;
}
interface MinimalDataBinding {
  alias: string;
  category?: DataCategory;
}

/**
 * Find an order binding by category, with optional alias and regex fallbacks.
 *
 * Resolution order:
 *   1. First binding whose `category` is in `categories`.
 *   2. First binding whose `alias` is in `aliasFallbacks` (legacy
 *      compatibility for bindings that pre-date category typing).
 *   3. First binding whose `alias` matches any of `aliasPatterns` (e.g.
 *      `^shutter\d*_state$` for indexed channels).
 *
 * Always pass at least one category. The fallbacks are for migration —
 * once every plugin emits a category and every binding carries one,
 * fallbacks can be dropped.
 *
 * @example
 * const move = findOrderByCategory(
 *   eq.orderBindings,
 *   ["pool_cover_move", "shutter_move"],
 *   ["state"],
 *   [/^shutter\d*_state$/],
 * );
 * if (move) await onExecuteOrder(move.alias, "OPEN");
 */
export function findOrderByCategory<T extends MinimalOrderBinding>(
  bindings: readonly T[],
  categories: readonly OrderCategory[],
  aliasFallbacks?: readonly string[],
  aliasPatterns?: readonly RegExp[],
): T | undefined {
  const byCategory = bindings.find(
    (b) => b.category !== undefined && categories.includes(b.category),
  );
  if (byCategory) return byCategory;
  if (aliasFallbacks && aliasFallbacks.length > 0) {
    const byAlias = bindings.find((b) => aliasFallbacks.includes(b.alias));
    if (byAlias) return byAlias;
  }
  if (aliasPatterns && aliasPatterns.length > 0) {
    return bindings.find((b) => aliasPatterns.some((re) => re.test(b.alias)));
  }
  return undefined;
}

/** Find a data binding by category, with the same fallback semantics. */
export function findDataByCategory<T extends MinimalDataBinding>(
  bindings: readonly T[],
  categories: readonly DataCategory[],
  aliasFallbacks?: readonly string[],
  aliasPatterns?: readonly RegExp[],
): T | undefined {
  const byCategory = bindings.find(
    (b) => b.category !== undefined && categories.includes(b.category),
  );
  if (byCategory) return byCategory;
  if (aliasFallbacks && aliasFallbacks.length > 0) {
    const byAlias = bindings.find((b) => aliasFallbacks.includes(b.alias));
    if (byAlias) return byAlias;
  }
  if (aliasPatterns && aliasPatterns.length > 0) {
    return bindings.find((b) => aliasPatterns.some((re) => re.test(b.alias)));
  }
  return undefined;
}

// ============================================================
// Write-side auto-binding (existing)
// ============================================================

/** Maps equipment types to relevant data categories for auto-binding. */
const RELEVANT_DATA: Record<string, string[]> = {
  light_onoff: ["light_state"],
  light_dimmable: ["light_state", "light_brightness"],
  light_color: ["light_state", "light_brightness", "light_color", "light_color_temp"],
  shutter: ["shutter_position"],
  awning: ["shutter_position"],
  switch: ["light_state"],
  sensor: ["temperature", "humidity", "pressure", "luminosity", "co2", "voc", "noise", "motion", "contact_door", "contact_window", "water_leak", "smoke", "battery"],
  button: ["action", "battery"],
  thermostat: ["temperature", "generic"],
  weather: ["temperature", "temperature_outdoor", "humidity", "humidity_outdoor", "pressure", "wind", "rain", "noise", "battery"],
  weather_forecast: ["weather_condition", "temperature_outdoor", "rain", "wind"],
  gate: ["generic", "contact_door"],
  heater: ["generic", "light_state"],
  energy_meter: ["energy", "power"],
  main_energy_meter: ["energy", "power"],
  energy_production_meter: ["energy", "power"],
  solar_panel: ["power", "energy", "voltage", "current", "temperature_device"],
  media_player: ["generic"],
  appliance: ["generic", "energy"],
  water_valve: ["light_state", "battery", "generic"],
  // Accept both the spec-correct Sowel categories and the legacy Tasmota
  // categories (generic for relays, position for shutter) so users on older
  // plugin versions still get auto-bindings.
  pool_pump: ["light_state", "generic"],
  pool_cover: ["shutter_position", "position", "generic"],
  pool_heat_pump: [
    "pool_water_temperature",
    "pool_temperature_setpoint",
    "temperature_outdoor",
    "appliance_state",
    "light_state",
  ],
  // Spec 120 — Sowel-supervised displays. `generic` catches the
  // hostname / ip_address informational fields surfaced by the
  // plugin alongside the canonical 5.
  display: [
    "firmware_version",
    "uptime",
    "rssi",
    "language",
    "display_brightness",
    "generic",
  ],
};

/** Maps equipment types to relevant order keys for auto-binding. */
const RELEVANT_ORDERS: Record<string, string[]> = {
  light_onoff: ["state", "on", "R1", "R2", "R3", "R4"],
  light_dimmable: ["state", "on", "brightness", "R1", "R2", "R3", "R4"],
  light_color: ["state", "on", "brightness", "color", "color_temp", "R1", "R2", "R3", "R4"],
  shutter: ["position", "state", "target_position"],
  awning: ["position", "state", "target_position"],
  switch: ["state", "on", "R1", "R2", "R3", "R4"],
  button: [],
  thermostat: ["power", "operationMode", "targetTemperature", "fanSpeed", "airSwingUD", "airSwingLR", "ecoMode", "nanoe", "profile", "resetAlarm"],
  weather: [],
  weather_forecast: [],
  gate: ["R1", "R2", "R3", "R4", "command", "gate_trigger"],
  heater: ["state", "on", "R1", "R2", "R3", "R4"],
  energy_meter: [],
  main_energy_meter: [],
  energy_production_meter: [],
  solar_panel: [],
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
  pool_heat_pump: ["setpoint"],
  // Spec 120 — Sowel-supervised displays.  Order keys mirror what
  // the displays plugin declares (see parse-state.ts of
  // sowel-plugin-displays): the key IS the topic suffix.
  // Spec 122 — `wake` added: a no-value action that asks the firmware
  // to restore its last user-chosen brightness via the cmd/wake MQTT
  // topic.  Without this whitelist entry, the UI auto-binding would
  // drop the wake order during equipment creation.
  display: ["language", "brightness", "wake"],
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
    // A blind single-button gate (e.g. Somfy RTS via somfyrts2mqtt) exposes a
    // `gate_trigger` order. GateControl only reacts to the `command` alias, so
    // both the manual AddBindingModal (no category → STANDARD_ALIASES) and any
    // R1..R4 relay gate resolve to `command`.
    gate_trigger: "command",
    R1: "command",
    R2: "command",
    R3: "command",
    R4: "command",
  },
  light_onoff: { R1: "state", R2: "state", R3: "state", R4: "state" },
  light_dimmable: { R1: "state", R2: "state", R3: "state", R4: "state" },
  light_color: { R1: "state", R2: "state", R3: "state", R4: "state" },
  switch: { R1: "state", R2: "state", R3: "state", R4: "state" },
  heater: { R1: "state", R2: "state", R3: "state", R4: "state" },
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
};

/**
 * Category-based aliasing — plugin-agnostic. Whenever an order/data has a
 * well-known semantic category, the alias is derived from the category, not
 * from the (plugin-specific) key name. Checked first; falls back to the
 * per-type key map above, then to the raw key.
 */
const ORDER_CATEGORY_ALIASES: Record<string, string> = {
  light_toggle: "state",
  toggle_power: "state",
  valve_toggle: "state",
  pool_pump_toggle: "state",
  shutter_move: "state",
  pool_cover_move: "state",
  set_shutter_position: "position",
  pool_cover_position: "position",
  set_brightness: "brightness",
  set_color_temp: "color_temp",
  set_color: "color",
  set_setpoint: "setpoint",
  set_pool_temperature_setpoint: "setpoint",
  gate_trigger: "command",
};

const DATA_CATEGORY_ALIASES: Record<string, string> = {
  light_state: "state",
  shutter_position: "position",
  light_brightness: "brightness",
  light_color_temp: "color_temp",
  light_color: "color",
  setpoint: "setpoint",
  pool_temperature_setpoint: "setpoint",
  pool_water_temperature: "temperature",
  battery: "battery",
  cover_state: "state",
};

/**
 * Resolve a device key to the standardized equipment alias for the given type.
 * Priority:
 *   1. Order / data category (plugin-agnostic)
 *   2. Per-type key map (legacy conventions like lora2mqtt R1..R4)
 *   3. Raw key
 */
export function resolveAlias(
  key: string,
  equipmentType: string,
  categoryMap?: Record<string, string>,
  category?: string,
): string {
  if (category && categoryMap && categoryMap[category]) return categoryMap[category];
  return STANDARD_ALIASES[equipmentType]?.[key] ?? key;
}

export function isRelevantData(category: string, equipmentType: string): boolean {
  return RELEVANT_DATA[equipmentType]?.includes(category) ?? false;
}

export function isRelevantOrder(key: string, equipmentType: string): boolean {
  return RELEVANT_ORDERS[equipmentType]?.includes(key) ?? false;
}

/** Equipment types whose bindings are spec'd as structured candidates
 * (see src/equipments/binding-candidates.ts). For these, we honour the
 * candidate chosen in DeviceSelector (or pick the first) and bind exactly
 * its data/order keys — no more, no less. Must stay in sync with the
 * DeviceSelector's own CANDIDATE_BASED_TYPES. */
const CANDIDATE_BASED_TYPES: ReadonlySet<EquipmentType> = new Set<EquipmentType>([
  "pool_pump",
  "pool_cover",
  "pool_heat_pump",
  "light_onoff",
  "light_dimmable",
  "light_color",
  "switch",
  "shutter",
  "awning",
  // NOTE: water_valve is intentionally key-driven (RELEVANT_DATA/RELEVANT_ORDERS),
  // NOT candidate-based — see the matching note in DeviceSelector. It binds its
  // full surface (state + flow + battery + irrigation), and its open/close is a
  // boolean `light_toggle` order the candidate path (enum ON/OFF only) ignores.
  // Spec 125 — one candidate per inverter channel (ch<N>_*), so a 2-panel DS3
  // yields Panel 1 / Panel 2 and each equipment binds only its channel.
  "solar_panel",
]);

/** Auto-create DataBindings and OrderBindings for selected devices. */
export async function autoCreateBindings(
  equipmentId: string,
  deviceIds: string[],
  equipmentType: string,
  /** deviceId → chosen candidate.id (from DeviceSelector picker). Optional:
   * when missing, falls back to the first candidate. */
  candidateByDevice?: Record<string, string>,
): Promise<void> {
  const usedDataAliases = new Set<string>();
  const usedOrderAliases = new Set<string>();
  const useCandidates = CANDIDATE_BASED_TYPES.has(equipmentType as EquipmentType);

  for (const deviceId of deviceIds) {
    try {
      const device = await getDevice(deviceId);

      // Candidate-based binding: compute the functional channels the device
      // offers for this equipment type and bind only the selected candidate's
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
        // Honour the explicit pick when present; otherwise default to the
        // first candidate (deterministic).
        const chosenId = candidateByDevice?.[deviceId];
        const chosen = candidates.find((c) => c.id === chosenId) ?? candidates[0];
        const allowedData = new Set(chosen.dataKeys);
        const allowedOrders = new Set(chosen.orderKeys);

        for (const data of device.data) {
          if (!allowedData.has(data.key)) continue;
          const alias = uniqueAlias(
            resolveAlias(data.key, equipmentType, DATA_CATEGORY_ALIASES, data.category),
            usedDataAliases,
          );
          try {
            await addDataBinding(equipmentId, { deviceDataId: data.id, alias });
            usedDataAliases.add(alias);
          } catch {
            // Alias conflict — skip
          }
        }
        for (const order of device.orders) {
          if (!allowedOrders.has(order.key)) continue;
          const alias = uniqueAlias(
            resolveAlias(order.key, equipmentType, ORDER_CATEGORY_ALIASES, order.category),
            usedOrderAliases,
          );
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
          const alias = uniqueAlias(
            resolveAlias(data.key, equipmentType, DATA_CATEGORY_ALIASES, data.category),
            usedDataAliases,
          );
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
          const alias = uniqueAlias(
            resolveAlias(order.key, equipmentType, ORDER_CATEGORY_ALIASES, order.category),
            usedOrderAliases,
          );
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
