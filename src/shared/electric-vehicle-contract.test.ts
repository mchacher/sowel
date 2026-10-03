import { describe, expect, it } from "vitest";
import {
  ELECTRIC_VEHICLE_CATEGORY_ALIASES,
  ELECTRIC_VEHICLE_CORE,
  isElectricVehicleDevice,
  isEvChargingState,
  splitElectricVehicleExtras,
} from "./electric-vehicle-contract.js";

describe("electric vehicle contract (spec 183)", () => {
  it("declares the core: readings, the charge limit on both sides, wake and charge_start as orders", () => {
    const data = ELECTRIC_VEHICLE_CORE.filter((e) => e.data).map((e) => e.alias);
    const orders = ELECTRIC_VEHICLE_CORE.filter((e) => e.order).map((e) => e.alias);
    expect(data).toEqual([
      "battery_level",
      "range",
      "plugged",
      "charging_state",
      "reported_at",
      "at_home",
      "mileage",
      "charge_limit",
    ]);
    expect(orders).toEqual(["charge_limit", "wake", "charge_start", "refresh"]);
  });

  it("maps every contract category to its alias", () => {
    expect(ELECTRIC_VEHICLE_CATEGORY_ALIASES).toEqual({
      ev_battery_level: "battery_level",
      ev_range: "range",
      ev_plugged: "plugged",
      ev_charging_state: "charging_state",
      ev_reported_at: "reported_at",
      ev_at_home: "at_home",
      ev_mileage: "mileage",
      ev_charge_limit: "charge_limit",
      set_ev_charge_limit: "charge_limit",
      ev_wake: "wake",
      ev_charge_start: "charge_start",
      ev_refresh: "refresh",
    });
  });

  it("recognises a car by its traction-battery level, not by a device battery", () => {
    expect(isElectricVehicleDevice([{ category: "ev_battery_level" }])).toBe(true);
    expect(isElectricVehicleDevice([{ category: "battery" }, { category: "power" }])).toBe(false);
  });

  it("accepts exactly the seven charging states", () => {
    for (const v of [
      "unplugged",
      "idle",
      "scheduled",
      "waiting",
      "charging",
      "completed",
      "error",
    ]) {
      expect(isEvChargingState(v)).toBe(true);
    }
    for (const v of ["plugged", "0.3", null, 1]) expect(isEvChargingState(v)).toBe(false);
  });

  it("keeps a plug-in hybrid's fuel and climate as extras, sorted", () => {
    const { extraData, extraOrders } = splitElectricVehicleExtras(
      [
        { alias: "fuelAutonomy" },
        { alias: "battery_level" },
        { alias: "hvacStatus" },
        { alias: "fuelQuantity" },
        { alias: "charge_limit" },
      ],
      [{ alias: "wake" }, { alias: "horn" }],
    );
    expect(extraData.map((b) => b.alias)).toEqual(["fuelAutonomy", "fuelQuantity", "hvacStatus"]);
    expect(extraOrders.map((b) => b.alias)).toEqual(["horn"]);
  });
});
