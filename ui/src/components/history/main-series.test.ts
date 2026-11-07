import { describe, it, expect } from "vitest";
import { mainHistoryAlias } from "./main-series";
import type { HistoryBindingState } from "../../types";

const b = (alias: string, category: string, effectiveOn = true) =>
  ({ alias, category, effectiveOn }) as Pick<HistoryBindingState, "alias" | "category" | "effectiveOn">;

// Spec 196, slice 9 (pr9-graphique) — the series open on arrival.

describe("mainHistoryAlias", () => {
  it("picks the main series of each type the slice names", () => {
    const pac = [b("setpoint", "temperature"), b("power", "power"), b("temperature", "temperature")];
    expect(mainHistoryAlias("thermostat", [b("power", "power"), b("inside", "temperature")])).toBe("inside");
    expect(mainHistoryAlias("thermostat", pac)).toBe("temperature"); // never the setpoint
    expect(mainHistoryAlias("ev_charger", [b("voltage", "voltage"), b("power", "power")])).toBe("power");
    expect(mainHistoryAlias("shutter", [b("position", "shutter_position")])).toBe("position");
    expect(mainHistoryAlias("electric_vehicle", [b("range", "distance"), b("battery_level", "battery")])).toBe("battery_level");
    expect(
      mainHistoryAlias("pool_heat_pump", [b("air", "temperature"), b("effective_water_temperature", "temperature")]),
    ).toBe("effective_water_temperature");
  });

  it("skips series that are not historized or internal, and types with no main series", () => {
    expect(mainHistoryAlias("ev_charger", [b("power", "power", false)])).toBeUndefined();
    expect(mainHistoryAlias("switch", [b("energy", "power")])).toBeUndefined();
    expect(mainHistoryAlias("light_onoff", [b("power", "power")])).toBeUndefined();
  });
});
