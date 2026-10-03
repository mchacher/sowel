import { describe, expect, it } from "vitest";
import {
  EV_CHARGER_CATEGORY_ALIASES,
  EV_CHARGER_CORE,
  isEvChargerDevice,
  isEvVehicleState,
  splitEvChargerExtras,
} from "./ev-charger-contract.js";

describe("EV charger contract (spec 182)", () => {
  it("declares the core: state and charge_current on both sides, the rest data only", () => {
    const row = (alias: string) => EV_CHARGER_CORE.find((e) => e.alias === alias);
    expect(row("state")).toEqual({ alias: "state", data: true, order: true });
    expect(row("charge_current")).toEqual({ alias: "charge_current", data: true, order: true });
    for (const alias of ["vehicle", "power", "energy", "session_energy", "current", "voltage"]) {
      expect(row(alias)).toEqual({ alias, data: true, order: false });
    }
    expect(EV_CHARGER_CORE).toHaveLength(8);
  });

  it("maps every contract category to its alias", () => {
    expect(EV_CHARGER_CATEGORY_ALIASES).toMatchObject({
      appliance_state: "state",
      light_state: "state",
      toggle_power: "state",
      light_toggle: "state",
      ev_vehicle_state: "vehicle",
      power: "power",
      energy: "energy",
      ev_charge_current: "charge_current",
      set_ev_charge_current: "charge_current",
      ev_session_energy: "session_energy",
      current: "current",
      voltage: "voltage",
    });
  });

  it("pins temperatures to charger_temperature, out of the zone average", () => {
    expect(EV_CHARGER_CATEGORY_ALIASES.temperature).toBe("charger_temperature");
    expect(EV_CHARGER_CATEGORY_ALIASES.temperature_device).toBe("charger_temperature");
  });

  it("recognises a charger by its vehicle state or its charging-current order", () => {
    expect(isEvChargerDevice([{ category: "ev_vehicle_state" }], [])).toBe(true);
    expect(isEvChargerDevice([], [{ category: "set_ev_charge_current" }])).toBe(true);
  });

  it("does not offer a plain relay or a metered plug", () => {
    expect(
      isEvChargerDevice(
        [{ category: "power" }, { category: "light_state" }],
        [{ category: "toggle_power" }],
      ),
    ).toBe(false);
    expect(isEvChargerDevice([{ category: null }], [{}])).toBe(false);
  });

  it("accepts exactly the three vehicle states", () => {
    for (const v of ["disconnected", "connected", "charging"])
      expect(isEvVehicleState(v)).toBe(true);
    for (const v of ["plugged", "CHARGING", null, undefined, 1])
      expect(isEvVehicleState(v)).toBe(false);
  });

  it("splits extras from the core, sorted by alias", () => {
    const data = [
      { alias: "status" },
      { alias: "power" },
      { alias: "charger_temperature" },
      { alias: "vehicle" },
      { alias: "last_session_energy" },
    ];
    const orders = [{ alias: "plug_in_action" }, { alias: "state" }, { alias: "charge_current" }];
    const { extraData, extraOrders } = splitEvChargerExtras(data, orders);
    expect(extraData.map((b) => b.alias)).toEqual([
      "charger_temperature",
      "last_session_energy",
      "status",
    ]);
    expect(extraOrders.map((b) => b.alias)).toEqual(["plug_in_action"]);
  });
});
