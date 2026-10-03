import { describe, expect, it } from "vitest";
import { defaultEnergyClassFor, defaultEnergyTimingsFor } from "./constants.js";

describe("flexible-load defaults per equipment type (spec 140, spec 182)", () => {
  it("makes an EV charger a deferrable load, 10 min on / 5 min off", () => {
    expect(defaultEnergyClassFor("ev_charger")).toBe("deferrable");
    expect(defaultEnergyTimingsFor("ev_charger")).toEqual({ minOnS: 600, minOffS: 300 });
  });

  it("leaves the other types unchanged", () => {
    expect(defaultEnergyClassFor("water_heater")).toBe("deferrable");
    expect(defaultEnergyClassFor("vmc")).toBe("deferrable");
    expect(defaultEnergyClassFor("thermostat")).toBe("comfort");
    expect(defaultEnergyClassFor("switch")).toBeNull();
    expect(defaultEnergyTimingsFor("water_heater")).toEqual({ minOnS: 300, minOffS: 300 });
    expect(defaultEnergyTimingsFor("vmc")).toEqual({ minOnS: 60, minOffS: 30 });
    expect(defaultEnergyTimingsFor("thermostat")).toEqual({ minOnS: 900, minOffS: 600 });
    expect(defaultEnergyTimingsFor("switch")).toEqual({ minOnS: 900, minOffS: 300 });
  });
});
