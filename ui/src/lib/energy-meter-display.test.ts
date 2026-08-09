import { describe, it, expect } from "vitest";
import {
  pickLivePowerW,
  pickVoltageV,
  pickCurrentA,
  pickPowerFactor,
  formatWatts,
} from "./energy-meter-display";
import type { DataBindingWithValue } from "../types";

function binding(overrides: Partial<DataBindingWithValue>): DataBindingWithValue {
  return {
    id: "b1",
    equipmentId: "e1",
    deviceDataId: "d1",
    alias: "power",
    deviceId: "dev1",
    deviceName: "Meter",
    key: "power",
    type: "number",
    category: "power",
    value: 100,
    unit: "W",
    lastUpdated: null,
    lastChanged: null,
    stale: false,
    ...overrides,
  } as DataBindingWithValue;
}

describe("pickLivePowerW", () => {
  it("returns the first power-category binding value", () => {
    const bindings = [
      binding({ alias: "energy", category: "energy", value: 138 }),
      binding({ id: "b2", alias: "power", category: "power", value: 1257 }),
    ];
    expect(pickLivePowerW(bindings)).toBe(1257);
  });

  it("falls back to the demand_5min alias when no power-category binding exists", () => {
    const bindings = [
      binding({ alias: "demand_5min", category: "generic", value: 420 }),
      binding({ id: "b2", alias: "energy", category: "energy", value: 138 }),
    ];
    expect(pickLivePowerW(bindings)).toBe(420);
  });

  it("ignores non-numeric values", () => {
    const bindings = [
      binding({ category: "power", value: null }),
      binding({ id: "b2", alias: "demand_5min", category: "generic", value: "n/a" }),
    ];
    expect(pickLivePowerW(bindings)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(pickLivePowerW([binding({ alias: "energy", category: "energy" })])).toBeNull();
  });
});

describe("pickVoltageV / pickCurrentA", () => {
  it("returns the voltage and current binding values", () => {
    const bindings = [
      binding({ id: "v", alias: "voltage", category: "voltage", value: 229.7, unit: "V" }),
      binding({ id: "c", alias: "current", category: "current", value: 6.92, unit: "A" }),
    ];
    expect(pickVoltageV(bindings)).toBe(229.7);
    expect(pickCurrentA(bindings)).toBe(6.92);
  });

  it("returns null when not bound or non-numeric", () => {
    expect(pickVoltageV([binding({ category: "voltage", value: null })])).toBeNull();
    expect(pickCurrentA([])).toBeNull();
  });
});

describe("pickPowerFactor", () => {
  it("matches the power_factor and pf aliases regardless of category", () => {
    expect(
      pickPowerFactor([binding({ alias: "power_factor", category: "generic", value: 0.92 })]),
    ).toBe(0.92);
    expect(pickPowerFactor([binding({ alias: "pf", category: "generic", value: 0.85 })])).toBe(
      0.85,
    );
  });

  it("returns null when absent or non-numeric", () => {
    expect(pickPowerFactor([binding({ alias: "power_factor", value: null })])).toBeNull();
    expect(pickPowerFactor([binding({ alias: "power", category: "power" })])).toBeNull();
  });
});

describe("formatWatts", () => {
  it("keeps watts below 1 kW", () => {
    expect(formatWatts(850)).toEqual({ value: "850", unit: "W" });
    expect(formatWatts(0)).toEqual({ value: "0", unit: "W" });
  });

  it("switches to kW at 1000 W", () => {
    expect(formatWatts(1257)).toEqual({ value: "1.3", unit: "kW" });
  });

  it("handles negative power (injection)", () => {
    expect(formatWatts(-1500)).toEqual({ value: "-1.5", unit: "kW" });
  });
});
