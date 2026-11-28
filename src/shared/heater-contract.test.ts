import { describe, expect, it } from "vitest";
import {
  PILOT_WIRE_MODES,
  heaterModeOrder,
  isHeaterRunning,
  pilotWireBindingKeys,
  resolveHeaterState,
  zoneHeaterModes,
} from "./heater-contract.js";

const relay = (value: unknown) => ({ alias: "state", category: "light_state", value });
const mode = (value: unknown) => ({
  alias: "pilot_wire_mode",
  category: "pilot_wire_mode",
  value,
});
const order = (enumValues?: string[]) => ({ category: "set_pilot_wire_mode", enumValues });

describe("resolveHeaterState (spec 217)", () => {
  it("reads a relay as before: ON is eco, OFF or no reading is comfort", () => {
    expect(resolveHeaterState([relay(true)], []).mode).toBe("eco");
    expect(resolveHeaterState([relay("on")], []).mode).toBe("eco");
    expect(resolveHeaterState([relay(false)], []).mode).toBe("comfort");
    expect(resolveHeaterState([], [])).toEqual({
      wiring: "relay",
      mode: "comfort",
      modes: ["comfort", "eco"],
    });
  });

  it("lets the pilot mode win over a contradictory state", () => {
    for (const state of [true, false]) {
      const s = resolveHeaterState([relay(state), mode("frost_protection")], [order()]);
      expect(s).toMatchObject({ wiring: "pilot", mode: "frost_protection" });
    }
  });

  it("keeps a missing or foreign pilot value unknown, never comfort", () => {
    for (const value of [null, undefined, "comfort_-1", 3]) {
      const s = resolveHeaterState([relay(false), mode(value)], [order()]);
      expect(s).toMatchObject({ wiring: "pilot", mode: null });
      expect(isHeaterRunning(s)).toBe(false);
    }
  });

  it("offers the declared modes, without foreign values, or all six", () => {
    expect(resolveHeaterState([], [order(["off", "eco", "comfort", "boost"])]).modes).toEqual([
      "comfort",
      "eco",
      "off",
    ]);
    expect(resolveHeaterState([], [order()]).modes).toEqual(PILOT_WIRE_MODES);
  });

  it("offers nothing without an order, and reads nothing without data", () => {
    expect(resolveHeaterState([mode("eco")], [])).toEqual({
      wiring: "pilot",
      mode: "eco",
      modes: [],
    });
    expect(resolveHeaterState([], [order()]).mode).toBeNull();
  });

  it("stays a relay while the point has no category (plugin not updated)", () => {
    const s = resolveHeaterState(
      [{ alias: "pilot_wire_mode", category: "generic", value: "off" }, relay(true)],
      [],
    );
    expect(s).toMatchObject({ wiring: "relay", mode: "eco" });
  });
});

describe("pilotWireBindingKeys (spec 217)", () => {
  it("keeps the mode and the metering, not the state nor the probes", () => {
    expect(
      pilotWireBindingKeys(
        [
          { key: "state", category: "light_state" },
          { key: "temperature", category: "temperature" },
          { key: "power", category: "power" },
          { key: "energy", category: "energy" },
          { key: "pilot_wire_mode", category: "pilot_wire_mode" },
        ],
        [
          { key: "state", category: "light_toggle" },
          { key: "power_on_behavior" },
          { key: "pilot_wire_mode", category: "set_pilot_wire_mode" },
        ],
      ),
    ).toEqual({ dataKeys: ["pilot_wire_mode", "power", "energy"], orderKeys: ["pilot_wire_mode"] });
  });

  it("is null for a relay", () => {
    expect(pilotWireBindingKeys([{ key: "state", category: "light_state" }], [])).toBeNull();
  });
});

describe("heaterModeOrder (spec 218)", () => {
  const pilotOrder = (enumValues?: string[]) => ({
    alias: "pilot_wire_mode",
    ...order(enumValues),
  });
  const toggle = (enumValues?: string[]) => ({
    alias: "state",
    category: "light_toggle",
    enumValues,
  });

  it("sends an accepted mode to a pilot module", () => {
    const orders = [pilotOrder(["comfort", "eco", "frost_protection"])];
    const state = resolveHeaterState([mode("comfort")], orders);
    expect(heaterModeOrder(state, orders, "frost_protection")).toEqual({
      alias: "pilot_wire_mode",
      value: "frost_protection",
    });
  });

  it("skips a mode the pilot module does not accept", () => {
    const orders = [pilotOrder(["comfort", "eco"])];
    const state = resolveHeaterState([mode("comfort")], orders);
    expect(heaterModeOrder(state, orders, "off")).toBeNull();
  });

  it("switches a relay OFF for comfort and ON for eco", () => {
    const orders = [toggle()];
    const state = resolveHeaterState([relay("OFF")], orders);
    expect(heaterModeOrder(state, orders, "comfort")).toEqual({ alias: "state", value: "OFF" });
    expect(heaterModeOrder(state, orders, "eco")).toEqual({ alias: "state", value: "ON" });
  });

  it("uses the relay's declared casing", () => {
    const orders = [toggle(["on", "off"])];
    const state = resolveHeaterState([relay("on")], orders);
    expect(heaterModeOrder(state, orders, "eco")).toEqual({ alias: "state", value: "on" });
  });

  it("finds the relay toggle by category before the state alias", () => {
    const orders = [{ alias: "power", category: "toggle_power", enumValues: null }];
    const state = resolveHeaterState([relay("OFF")], orders);
    expect(heaterModeOrder(state, orders, "eco")).toEqual({ alias: "power", value: "ON" });
  });

  it("never moves a relay to an approximation of another mode", () => {
    const orders = [toggle()];
    const state = resolveHeaterState([relay("OFF")], orders);
    for (const m of ["comfort_minus_1", "comfort_minus_2", "frost_protection", "off"] as const) {
      expect(heaterModeOrder(state, orders, m)).toBeNull();
    }
  });

  it("returns null for a relay without a toggle order", () => {
    const state = resolveHeaterState([relay("OFF")], []);
    expect(heaterModeOrder(state, [], "eco")).toBeNull();
  });
});

describe("zoneHeaterModes (spec 218)", () => {
  const relayHeater = (value: unknown) => ({
    data: [relay(value)],
    orders: [{ alias: "state", category: "light_toggle" }],
  });
  const pilotHeater = (value: unknown, enumValues?: string[]) => ({
    data: [mode(value)],
    orders: [{ alias: "pilot_wire_mode", ...order(enumValues) }],
  });

  it("offers comfort and eco for relays only", () => {
    expect(zoneHeaterModes([relayHeater("OFF"), relayHeater("ON")])).toEqual({
      modes: ["comfort", "eco"],
      common: null,
    });
  });

  it("offers the union in contract order", () => {
    const result = zoneHeaterModes([
      pilotHeater("eco", ["off", "frost_protection", "eco"]),
      relayHeater("ON"),
    ]);
    expect(result).toEqual({ modes: ["comfort", "eco", "frost_protection", "off"], common: "eco" });
  });

  it("has a common mode only when every heater reports the same known one", () => {
    expect(zoneHeaterModes([relayHeater("OFF"), pilotHeater("comfort")]).common).toBe("comfort");
    expect(zoneHeaterModes([relayHeater("ON"), pilotHeater("comfort")]).common).toBeNull();
    expect(zoneHeaterModes([pilotHeater("comfort"), pilotHeater("bogus")]).common).toBeNull();
  });

  it("offers nothing when no heater can be commanded", () => {
    expect(zoneHeaterModes([{ data: [mode("eco")], orders: [] }])).toEqual({
      modes: [],
      common: null,
    });
    expect(zoneHeaterModes([])).toEqual({ modes: [], common: null });
  });
});
