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
  DeviceData,
  DeviceOrder,
  DeviceWithDetails,
  EquipmentType,
  OrderBindingWithDetails,
  OrderCategory,
} from "../../types";
import {
  CANDIDATE_BASED_TYPES,
  THERMOSTAT_STATE_ALIAS,
  computeBindingCandidates,
} from "../../lib/binding-candidates";
import { resolveHistorize } from "../../lib/history-defaults";

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

/**
 * Spec 152 — resolve the MAIN on/off command of a light/switch/water_heater,
 * mirroring exactly what `LightControl` binds to (category-first, then the loose
 * boolean/`state`-enum fallback), while never matching the dedicated solar
 * channel. Callers use it as the render gate for the main toggle so the gate and
 * the control resolve identically (no "gate hides a toggle LightControl would
 * still render" regression for legacy uncategorized bindings).
 */
export function findMainOnOffOrder<T extends MinimalOrderBinding & { type?: string }>(
  bindings: readonly T[],
): T | undefined {
  return (
    findOrderByCategory(bindings, ["light_toggle", "toggle_power"], ["state"]) ??
    bindings.find(
      (b) =>
        b.alias !== "solar" &&
        b.category !== "solar_toggle" &&
        (b.type === "boolean" || (b.alias === "state" && b.type === "enum")),
    )
  );
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
  // `power` / `setpoint` / `temperature_outdoor` are the spec 077 standardized
  // thermostat categories (a Panasonic or MCZ device reports its run state,
  // target and outdoor probe under them); the list predated that spec, so a
  // freshly bound thermostat silently lost those points.
  thermostat: ["temperature", "temperature_outdoor", "setpoint", "power", "generic"],
  weather: ["temperature", "temperature_outdoor", "humidity", "humidity_outdoor", "pressure", "wind", "rain", "noise", "battery"],
  weather_forecast: ["weather_condition", "temperature_outdoor", "rain", "wind"],
  // gate auto-binding is candidate-based (spec 150); this entry only feeds the
  // manual AddBindingModal suggestions.
  gate: ["generic", "contact_door"],
  heater: ["generic", "light_state"],
  // Spec 135 — water heater: on/off relay (light_state) + optional water
  // temperature (aliased water_temperature so it stays out of the zone room
  // average) + optional power/energy when the relay meters consumption.
  water_heater: ["light_state", "temperature", "power", "energy"],
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
  // Spec 133 — cameras. Deliberately a SUBSET of the 5 camera categories:
  // snapshot/stream/monitoring are auto-bound (the "just show me the
  // camera" default), but camera_light_mode and camera_detection are
  // opt-in only — the admin adds them later via AddBindingModal. See
  // "Per-equipment feature enablement" in spec 133.
  camera: ["camera_snapshot_url", "camera_stream_url", "camera_monitoring"],
  // Spec 156 — a UPS binds whatever its plugin reports. `generic` is in the
  // list on purpose: the secondary flags a UPS exposes (charging, self-test
  // result, model) have no category of their own and are worth seeing.
  ups: [
    "ups_status",
    "battery",
    "battery_runtime",
    "ups_load",
    "voltage",
    "temperature_device",
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
  // gate auto-binding is candidate-based (spec 150); kept for AddBindingModal.
  gate: ["R1", "R2", "R3", "R4", "command", "gate_trigger"],
  heater: ["state", "on", "R1", "R2", "R3", "R4"],
  water_heater: ["state", "on", "R1", "R2", "R3", "R4"],
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
  // Spec 156 — a UPS is read-only: no order ever auto-binds. The explicit
  // empty entry documents the intent, rather than leaving the type to fall
  // through the lookup as an accident.
  ups: [],
};

/**
 * Maps equipment types to relevant order *categories* for auto-binding —
 * used instead of `RELEVANT_ORDERS` (raw key names) when the order key is
 * vendor/plugin-specific and only the typed `OrderCategory` is stable
 * across plugins. Spec 133: only `set_camera_monitoring` auto-binds;
 * `set_camera_light_mode` / `trigger_camera_siren` are opt-in only.
 */
const RELEVANT_ORDER_CATEGORIES: Partial<Record<EquipmentType, OrderCategory[]>> = {
  camera: ["set_camera_monitoring"],
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
 * Per-equipment-type category → alias overrides, applied before the global
 * DATA_CATEGORY_ALIASES / ORDER_CATEGORY_ALIASES (data and order categories
 * are disjoint namespaces, so one map serves both).
 * - Spec 135: on a water heater, a `temperature` reading is the WATER
 *   temperature, aliased `water_temperature` so the zone aggregator (which
 *   only folds category=temperature bindings with alias exactly "temperature"
 *   into the room average) leaves it out.
 * - Spec 150: on a gate, an on/off relay order (light_toggle/toggle_power,
 *   e.g. a Zigbee dry-contact like the SONOFF MINI-ZBD) is the gate command.
 *   GateControl only reacts to the `command` alias; without this override the
 *   global ORDER_CATEGORY_ALIASES would alias it `state`.
 */
const TYPE_CATEGORY_ALIASES: Partial<Record<EquipmentType, Record<string, string>>> = {
  water_heater: { temperature: "water_temperature" },
  gate: { light_toggle: "command", toggle_power: "command" },
  // ThermostatCard drives its toggle through the `power` order alias;
  // without this override the global ORDER_CATEGORY_ALIASES would alias a
  // toggle_power order `state` and the card would lose its power button on
  // any newly bound thermostat. The outdoor probe pins to the alias every
  // thermostat surface reads, whatever the plugin calls the key — and stops
  // an outdoor point published under key `temperature` from stealing the
  // room-temperature alias.
  thermostat: { toggle_power: "power", temperature_outdoor: "outsideTemperature" },
};

/**
 * Resolve a device key to the standardized equipment alias for the given type.
 * Priority:
 *   1. Typed per-type rule (a thermostat's boolean power reading)
 *   2. Order / data category (plugin-agnostic)
 *   3. Per-type key map (legacy conventions like lora2mqtt R1..R4)
 *   4. Raw key
 */
export function resolveAlias(
  key: string,
  equipmentType: string,
  categoryMap?: Record<string, string>,
  category?: string,
  valueType?: string,
): string {
  // On a thermostat the boolean `power` reading is the run state reported by
  // the device itself. It must not claim the `power` alias: on a submetered
  // thermostat that alias is the wattage read from a clamp (the metering
  // convention pickLivePowerW relies on), and `UNIQUE(equipment_id, alias)`
  // means whichever binds first evicts the other — which is how the PAC lost
  // its on/off state (issue #901). The boolean binds under the same `state`
  // alias every relay-style equipment uses, and the UI reads it first for
  // the toggle.
  if (equipmentType === "thermostat" && category === "power" && valueType === "boolean") {
    return THERMOSTAT_STATE_ALIAS;
  }
  if (category) {
    const perType = TYPE_CATEGORY_ALIASES[equipmentType as EquipmentType]?.[category];
    if (perType) return perType;
    if (categoryMap && categoryMap[category]) return categoryMap[category];
  }
  return STANDARD_ALIASES[equipmentType]?.[key] ?? key;
}

export function isRelevantData(category: string, equipmentType: string): boolean {
  return RELEVANT_DATA[equipmentType]?.includes(category) ?? false;
}

export function isRelevantOrder(key: string, equipmentType: string, category?: OrderCategory): boolean {
  if (category && RELEVANT_ORDER_CATEGORIES[equipmentType as EquipmentType]?.includes(category)) {
    return true;
  }
  return RELEVANT_ORDERS[equipmentType]?.includes(key) ?? false;
}

// Spec 150 — CANDIDATE_BASED_TYPES now lives in the shared binding-candidates
// module (single source of truth with the backend), re-exported by
// ../../lib/binding-candidates (imported at the top of this file).

// ============================================================
// Binding plan (issue #707)
//
// Deciding WHAT to bind and actually binding it used to be one pass, so the
// only way to pick up a data point a plugin added after the equipment was
// created was to wipe every binding and rebuild — losing custom aliases and
// historization along the way. The decision is now a pure function the UI can
// show the owner before anything is written.
// ============================================================

/** One binding the auto-binder would create. */
export interface PlannedBinding {
  kind: "data" | "order";
  deviceId: string;
  deviceName: string;
  /** `device_data.id` for data, `device_order.id` for orders. */
  sourceId: string;
  /** The key as the device publishes it. */
  key: string;
  /** The alias it would be bound under, already deduplicated. */
  alias: string;
  category?: string;
  /** Whether this binding would be written to InfluxDB. Always false for orders. */
  historized: boolean;
}

interface PlanOptions {
  /** deviceId → chosen candidate.id (from the DeviceSelector picker). */
  candidateByDevice?: Record<string, string>;
  /** Aliases already taken on the equipment, so a plan added to an existing
   *  equipment cannot collide with `UNIQUE(equipment_id, alias)`. */
  usedDataAliases?: Iterable<string>;
  usedOrderAliases?: Iterable<string>;
  /**
   * Device data/order ids to leave out of the plan entirely. Skipped BEFORE an
   * alias is allocated: a point that is already bound under a renamed alias
   * must not burn its natural one, or a new point of the same category is
   * offered as `temperature_2` and the zone aggregator, which only folds
   * `alias === "temperature"` into the room average, silently leaves it out.
   */
  skipSourceIds?: ReadonlySet<string>;
}

/**
 * The bindings the auto-binder would create for these devices. Pure: it writes
 * nothing and fetches nothing, so it can back a confirmation list.
 */
export function computeBindingPlan(
  devices: DeviceWithDetails[],
  equipmentType: string,
  options: PlanOptions = {},
): PlannedBinding[] {
  const usedDataAliases = new Set<string>(options.usedDataAliases ?? []);
  const usedOrderAliases = new Set<string>(options.usedOrderAliases ?? []);
  const useCandidates = CANDIDATE_BASED_TYPES.has(equipmentType as EquipmentType);
  const plan: PlannedBinding[] = [];

  const skip = options.skipSourceIds;

  const pushData = (device: DeviceWithDetails, data: DeviceData, base: string) => {
    if (skip?.has(data.id)) return;
    const alias = uniqueAlias(base, usedDataAliases);
    usedDataAliases.add(alias);
    plan.push({
      kind: "data",
      deviceId: device.id,
      deviceName: device.name,
      sourceId: data.id,
      key: data.key,
      alias,
      ...(data.category !== undefined ? { category: data.category } : {}),
      historized: resolveHistorize(null, alias, data.category ?? "generic"),
    });
  };

  const pushOrder = (device: DeviceWithDetails, order: DeviceOrder, base: string) => {
    if (skip?.has(order.id)) return;
    const alias = uniqueAlias(base, usedOrderAliases);
    usedOrderAliases.add(alias);
    plan.push({
      kind: "order",
      deviceId: device.id,
      deviceName: device.name,
      sourceId: order.id,
      key: order.key,
      alias,
      ...(order.category !== undefined ? { category: order.category } : {}),
      historized: false,
    });
  };

  for (const device of devices) {
    try {
      planDevice(device);
    } catch {
      // Skip a device whose candidates cannot be computed, as the original
      // per-device try/catch did — one bad device must not lose the rest.
    }
  }

  function planDevice(device: DeviceWithDetails): void {
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
        return;
      }
      // Honour the explicit pick when present; otherwise default to the
      // first candidate (deterministic).
      const chosenId = options.candidateByDevice?.[device.id];
      const chosen = candidates.find((c) => c.id === chosenId) ?? candidates[0];
      const allowedData = new Set(chosen.dataKeys);
      const allowedOrders = new Set(chosen.orderKeys);

      // Spec 153 — a VMC maps its two on/off relay channels to fixed roles
      // `low` (first channel) and `high` (second), so the speed controller can
      // resolve them. Same alias for the matching state data. The generic
      // category aliasing would collapse both channels to `state`, so this
      // per-key map is applied first.
      const vmcAlias: Record<string, string> | null =
        equipmentType === "vmc"
          ? Object.fromEntries(
              chosen.orderKeys
                .slice()
                .sort((a, b) => a.localeCompare(b))
                .map((k, i) => [k, i === 0 ? "low" : "high"]),
            )
          : null;

      for (const data of device.data) {
        if (!allowedData.has(data.key)) continue;
        pushData(
          device,
          data,
          vmcAlias?.[data.key] ??
            resolveAlias(data.key, equipmentType, DATA_CATEGORY_ALIASES, data.category, data.type),
        );
      }
      for (const order of device.orders) {
        if (!allowedOrders.has(order.key)) continue;
        pushOrder(
          device,
          order,
          vmcAlias?.[order.key] ??
            resolveAlias(order.key, equipmentType, ORDER_CATEGORY_ALIASES, order.category),
        );
      }
      return;
    }

    // Legacy path for all other equipment types — bind everything that
    // matches the RELEVANT_DATA / RELEVANT_ORDERS whitelists.
    for (const data of device.data) {
      if (!isRelevantData(data.category, equipmentType)) continue;
      pushData(
        device,
        data,
        resolveAlias(data.key, equipmentType, DATA_CATEGORY_ALIASES, data.category, data.type),
      );
    }
    for (const order of device.orders) {
      if (!isRelevantOrder(order.key, equipmentType, order.category)) continue;
      pushOrder(
        device,
        order,
        resolveAlias(order.key, equipmentType, ORDER_CATEGORY_ALIASES, order.category),
      );
    }
  }

  return plan;
}

/**
 * The planned bindings this equipment does not have yet.
 *
 * This is what a plugin publishing a new data point produces: the key reaches
 * `device_data` at discovery, but nothing revisits an equipment bound before
 * it existed, so the point stays invisible (issue #707). Existing aliases seed
 * the deduplication, so a new key whose natural alias is already taken is
 * offered as `alias_2` rather than failing the unique constraint.
 */
export function computeMissingBindings(
  devices: DeviceWithDetails[],
  equipmentType: string,
  dataBindings: DataBindingWithValue[],
  orderBindings: OrderBindingWithDetails[],
): PlannedBinding[] {
  const boundData = new Set(dataBindings.map((b) => b.deviceDataId));
  const boundOrders = new Set(orderBindings.map((b) => b.deviceOrderId));

  // On a multi-channel device the equipment owns ONE functional channel, and
  // which one is only recorded in the bindings it already has. Planning with
  // the default (first) candidate would offer a foreign relay's state and
  // command — the cross-channel pollution spec 150 exists to prevent — and the
  // count could never reach zero for anyone bound to channel 2. Infer the
  // channel from the keys already bound, and leave the device out when nothing
  // matches rather than guessing.
  const candidateByDevice: Record<string, string> = {};
  let planned = devices;
  if (CANDIDATE_BASED_TYPES.has(equipmentType as EquipmentType)) {
    const boundKeys = new Map<string, Set<string>>();
    for (const b of [...dataBindings, ...orderBindings]) {
      const keys = boundKeys.get(b.deviceId) ?? new Set<string>();
      keys.add(b.key);
      boundKeys.set(b.deviceId, keys);
    }
    planned = devices.filter((device) => {
      const keys = boundKeys.get(device.id);
      if (!keys || keys.size === 0) return false;
      const candidates = computeBindingCandidates(
        equipmentType as EquipmentType,
        device.data,
        device.orders,
      );
      const owned = candidates.find(
        (c) =>
          c.dataKeys.some((k) => keys.has(k)) || c.orderKeys.some((k) => keys.has(k)),
      );
      if (!owned) return false;
      candidateByDevice[device.id] = owned.id;
      return true;
    });
  }

  return computeBindingPlan(planned, equipmentType, {
    candidateByDevice,
    usedDataAliases: dataBindings.map((b) => b.alias),
    usedOrderAliases: orderBindings.map((b) => b.alias),
    skipSourceIds: new Set([...boundData, ...boundOrders]),
  });
}

/**
 * Write a plan, one binding at a time. A binding that cannot be written (alias
 * conflict, already bound) does not abort the rest; the aliases that failed are
 * returned so a caller acting on an explicit confirmation can say so instead of
 * reporting a success that did not happen.
 */
export async function applyBindingPlan(
  equipmentId: string,
  plan: PlannedBinding[],
): Promise<{ added: number; failed: string[] }> {
  let added = 0;
  const failed: string[] = [];
  for (const item of plan) {
    try {
      if (item.kind === "data") {
        await addDataBinding(equipmentId, { deviceDataId: item.sourceId, alias: item.alias });
      } else {
        await addOrderBinding(equipmentId, { deviceOrderId: item.sourceId, alias: item.alias });
      }
      added++;
    } catch {
      failed.push(item.alias);
    }
  }
  return { added, failed };
}

/** Fetch the devices behind a set of ids, skipping any that cannot be read. */
export async function fetchDevices(deviceIds: string[]): Promise<DeviceWithDetails[]> {
  const devices: DeviceWithDetails[] = [];
  for (const deviceId of deviceIds) {
    try {
      devices.push(await getDevice(deviceId));
    } catch {
      // Skip failed device
    }
  }
  return devices;
}

/** Auto-create DataBindings and OrderBindings for selected devices. */
export async function autoCreateBindings(
  equipmentId: string,
  deviceIds: string[],
  equipmentType: string,
  /** deviceId → chosen candidate.id (from DeviceSelector picker). Optional:
   * when missing, falls back to the first candidate. */
  candidateByDevice?: Record<string, string>,
): Promise<void> {
  const devices = await fetchDevices(deviceIds);
  const plan = computeBindingPlan(devices, equipmentType, {
    ...(candidateByDevice !== undefined ? { candidateByDevice } : {}),
  });
  await applyBindingPlan(equipmentId, plan);
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
