import { describe, expect, it } from "vitest";
import {
  PILOT_WIRE_MODES,
  isHeaterRunning,
  pilotWireBindingKeys,
  resolveHeaterState,
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
