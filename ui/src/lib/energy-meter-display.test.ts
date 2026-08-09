import { describe, it, expect } from "vitest";
import {
  pickLivePowerW,
  formatWatts,
  formatEnergyWh,
  formatMeasurement,
  sortMeasurements,
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
  it("returns the power-category binding value first", () => {
    const bindings = [
      binding({ alias: "demand_5min", category: "power", value: 300 }),
      binding({ id: "b2", alias: "power", category: "power", value: 1257 }),
    ];
    // First matching power-category binding wins (binding order).
    expect(pickLivePowerW(bindings)).toBe(300);
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

describe("formatEnergyWh", () => {
  it("formats Wh, kWh and MWh tiers", () => {
    expect(formatEnergyWh(138)).toEqual({ value: "138", unit: "Wh" });
    expect(formatEnergyWh(30_709)).toEqual({ value: "30.71", unit: "kWh" });
    expect(formatEnergyWh(1_640_639)).toEqual({ value: "1.64", unit: "MWh" });
  });
});

describe("formatMeasurement", () => {
  it("formats voltage with one decimal and current with two", () => {
    expect(formatMeasurement(binding({ category: "voltage", value: 229.74, unit: "V" }))).toEqual({
      value: "229.7",
      unit: "V",
    });
    expect(formatMeasurement(binding({ category: "current", value: 1.011, unit: "A" }))).toEqual({
      value: "1.01",
      unit: "A",
    });
  });

  it("passes through generic values with their unit", () => {
    expect(formatMeasurement(binding({ category: "generic", value: 102, unit: "VA" }))).toEqual({
      value: "102",
      unit: "VA",
    });
  });

  it("renders a dash for null values", () => {
    expect(formatMeasurement(binding({ category: "power", value: null }))).toEqual({
      value: "—",
      unit: "W",
    });
  });
});

describe("sortMeasurements", () => {
  it("orders power, voltage, current, energy, then the rest, stably", () => {
    const bindings = [
      binding({ id: "1", alias: "power_apparent", category: "generic" }),
      binding({ id: "2", alias: "energy_forward", category: "energy" }),
      binding({ id: "3", alias: "energy_reverse", category: "energy" }),
      binding({ id: "4", alias: "voltage", category: "voltage" }),
      binding({ id: "5", alias: "power", category: "power" }),
    ];
    expect(sortMeasurements(bindings).map((b) => b.alias)).toEqual([
      "power",
      "voltage",
      "energy_forward",
      "energy_reverse",
      "power_apparent",
    ]);
  });
});
