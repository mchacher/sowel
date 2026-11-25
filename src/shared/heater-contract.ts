/**
 * Spec 217 — what a Sowel electric heater is.
 *
 * One equipment type, two wirings. The bound points decide which one applies:
 * - `pilot`: a pilot-wire module carries the full order, under the categories
 *   `pilot_wire_mode` / `set_pilot_wire_mode`. Any on/off `state` is ignored.
 * - `relay`: an on/off relay on the pilot wire, ON = eco, OFF = comfort. That
 *   is a property of the wiring, whatever protocol drives the relay.
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
  | { wiring: "relay"; mode: "comfort" | "eco"; modes: readonly ["comfort", "eco"] }
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
  const relayOn = relay?.value === true || String(relay?.value).toUpperCase() === "ON";
  return { wiring: "relay", mode: relayOn ? "eco" : "comfort", modes: RELAY_MODES };
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
