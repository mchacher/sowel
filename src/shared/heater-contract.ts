/**
 * Spec 217 — what a Sowel electric heater is.
 *
 * One equipment type, two wirings. The bound points decide which one applies:
 * - `pilot`: a pilot-wire module carries the full order, under the categories
 *   `pilot_wire_mode` / `set_pilot_wire_mode`. Any on/off `state` is ignored.
 * - `relay`: an on/off relay on the pilot wire, ON = eco, OFF = comfort. That
 *   is a property of the wiring, whatever protocol drives the relay. A relay
 *   with no reading is unknown, like a pilot module (#1331).
 *
 * Integrations translate their own vocabulary to the one below; nothing here
 * knows a vendor key or value. Pure TypeScript: the UI bundles it directly.
 */

import { METERING_CATEGORIES } from "./constants.js";
import type { DataCategory } from "./types.js";

export const PILOT_WIRE_MODES = [
  "comfort",
  "comfort_minus_1",
  "comfort_minus_2",
  "eco",
  "frost_protection",
  "off",
] as const;
export type PilotWireMode = (typeof PILOT_WIRE_MODES)[number];

export const PILOT_WIRE_DATA_CATEGORY = "pilot_wire_mode";
export const PILOT_WIRE_ORDER_CATEGORY = "set_pilot_wire_mode";
export const PILOT_WIRE_ALIAS = "pilot_wire_mode";

/** Category → contract alias, for data and orders alike. */
export const HEATER_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  [PILOT_WIRE_DATA_CATEGORY]: PILOT_WIRE_ALIAS,
  [PILOT_WIRE_ORDER_CATEGORY]: PILOT_WIRE_ALIAS,
};

export function isPilotWireMode(value: unknown): value is PilotWireMode {
  return typeof value === "string" && (PILOT_WIRE_MODES as readonly string[]).includes(value);
}

export type HeaterState =
  | { wiring: "relay"; mode: "comfort" | "eco" | null; modes: readonly ["comfort", "eco"] }
  | { wiring: "pilot"; mode: PilotWireMode | null; modes: readonly PilotWireMode[] };

interface HeaterData {
  alias: string;
  category?: string | null;
  value?: unknown;
}
interface HeaterOrder {
  category?: string | null;
  enumValues?: readonly string[] | null;
}

const RELAY_MODES = ["comfort", "eco"] as const;

/** The state of a heater, for both wirings. `mode: null` is unknown, never comfort. */
export function resolveHeaterState(
  data: readonly HeaterData[],
  orders: readonly HeaterOrder[],
): HeaterState {
  const reading = data.find((d) => d.category === PILOT_WIRE_DATA_CATEGORY);
  const order = orders.find((o) => o.category === PILOT_WIRE_ORDER_CATEGORY);
  if (reading || order) {
    const declared = order?.enumValues;
    return {
      wiring: "pilot",
      mode: isPilotWireMode(reading?.value) ? reading.value : null,
      modes: !order
        ? []
        : declared && declared.length > 0
          ? PILOT_WIRE_MODES.filter((m) => declared.includes(m))
          : PILOT_WIRE_MODES,
    };
  }
  const relay = data.find((d) => d.alias === "state" || d.category === "light_state");
  return { wiring: "relay", mode: relayMode(relay?.value), modes: RELAY_MODES };
}

/** ON is eco, OFF is comfort; anything else, a missing reading included, is unknown. */
function relayMode(value: unknown): "comfort" | "eco" | null {
  if (value === true) return "eco";
  if (value === false) return "comfort";
  const text = typeof value === "string" ? value.toUpperCase() : "";
  if (text === "ON") return "eco";
  if (text === "OFF") return "comfort";
  return null;
}

/** The radiator heats to its own setpoint, or just under it. */
export function isHeaterRunning(state: HeaterState): boolean {
  return (
    state.mode === "comfort" || state.mode === "comfort_minus_1" || state.mode === "comfort_minus_2"
  );
}

/**
 * The points a device binds as a pilot-wire heater: the mode and the metering.
 * Null when the device has no pilot-wire point (its binding is then the relay
 * one). `state` is left out: on such a module it does not mean comfort / eco,
 * and a recipe written for a relay would drive the radiator backwards.
 */
export function pilotWireBindingKeys(
  data: readonly { key: string; category?: string | null }[],
  orders: readonly { key: string; category?: string | null }[],
): { dataKeys: string[]; orderKeys: string[] } | null {
  const modeData = data.filter((d) => d.category === PILOT_WIRE_DATA_CATEGORY);
  const modeOrders = orders.filter((o) => o.category === PILOT_WIRE_ORDER_CATEGORY);
  if (modeData.length === 0 && modeOrders.length === 0) return null;
  const metering = data.filter((d) => METERING_CATEGORIES.has(d.category as DataCategory));
  return {
    dataKeys: [...modeData, ...metering].map((d) => d.key),
    orderKeys: modeOrders.map((o) => o.key),
  };
}

// ============================================================
// Spec 218 — heaters in zone orders
// ============================================================

interface HeaterModeOrderBinding {
  alias: string;
  category?: string | null;
  enumValues?: readonly string[] | null;
}

const RELAY_TOGGLE_CATEGORIES = ["toggle_power", "light_toggle"];

/** The on/off order of a relay heater: by category, then the `state` alias. */
function relayToggle<T extends HeaterModeOrderBinding>(orders: readonly T[]): T | undefined {
  return (
    orders.find((o) => o.category != null && RELAY_TOGGLE_CATEGORIES.includes(o.category)) ??
    orders.find((o) => o.alias === "state")
  );
}

/**
 * The order that puts one heater in `mode`, or null when it cannot. A relay
 * only takes comfort (OFF) and eco (ON): it is never moved to an approximation
 * of another mode. A pilot module only takes the modes it accepts.
 */
export function heaterModeOrder(
  state: HeaterState,
  orders: readonly HeaterModeOrderBinding[],
  mode: PilotWireMode,
): { alias: string; value: string } | null {
  if (state.wiring === "pilot") {
    if (!state.modes.includes(mode)) return null;
    const order = orders.find((o) => o.category === PILOT_WIRE_ORDER_CATEGORY);
    return order ? { alias: order.alias, value: mode } : null;
  }
  if (mode !== "comfort" && mode !== "eco") return null;
  const toggle = relayToggle(orders);
  if (!toggle) return null;
  const pattern = mode === "eco" ? /^on$/i : /^off$/i;
  const value = toggle.enumValues?.find((v) => pattern.test(v)) ?? (mode === "eco" ? "ON" : "OFF");
  return { alias: toggle.alias, value };
}

/**
 * The modes offered for a set of heaters (those at least one of them can take,
 * in contract order) and their common mode: the one they all report, when it
 * is the same and known. Heaters that take no mode are left out.
 */
export function zoneHeaterModes(
  heaters: readonly { data: readonly HeaterData[]; orders: readonly HeaterModeOrderBinding[] }[],
): { modes: PilotWireMode[]; common: PilotWireMode | null } {
  const offered = new Set<PilotWireMode>();
  const reported: (PilotWireMode | null)[] = [];
  for (const heater of heaters) {
    const state = resolveHeaterState(heater.data, heater.orders);
    const takes = PILOT_WIRE_MODES.filter((m) => heaterModeOrder(state, heater.orders, m) !== null);
    if (takes.length === 0) continue;
    for (const m of takes) offered.add(m);
    reported.push(state.mode);
  }
  const first = reported[0] ?? null;
  const common = first !== null && reported.every((m) => m === first) ? first : null;
  return { modes: PILOT_WIRE_MODES.filter((m) => offered.has(m)), common };
}
