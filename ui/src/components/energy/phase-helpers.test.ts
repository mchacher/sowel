import { describe, expect, it } from "vitest";
import type { DataBindingWithValue, EquipmentWithDetails } from "../../types";
import { extractPhases, formatPhasePower } from "./phase-helpers";

function makeBinding(
  partial: Partial<DataBindingWithValue> & { alias: string },
): DataBindingWithValue {
  return {
    id: "b-" + partial.alias,
    equipmentId: "eq",
    deviceDataId: "dd-" + partial.alias,
    deviceId: "d1",
    deviceName: "Device",
    key: partial.alias,
    type: "number",
    category: "power",
    value: 0,
    lastUpdated: "2026-07-30 08:00:00Z",
    lastChanged: "2026-07-30 08:00:00Z",
    stale: false,
    ...partial,
  };
}

function makeEquipment(
  id: string,
  bindings: DataBindingWithValue[],
): EquipmentWithDetails {
  return {
    id,
    name: id,
    zoneId: "z",
    type: "main_energy_meter",
    enabled: true,
    createdAt: "2026-07-01 00:00:00Z",
    updatedAt: "2026-07-01 00:00:00Z",
    dataBindings: bindings,
    orderBindings: [],
    status: "online",
  };
}

describe("extractPhases", () => {
  it("returns an empty array when no power_l{n} alias is bound anywhere", () => {
    const eq = makeEquipment("main", [makeBinding({ alias: "power", value: 500 })]);
    expect(extractPhases([eq])).toEqual([]);
  });

  it("returns a single entry when only power_l1 is bound", () => {
    const eq = makeEquipment("main", [makeBinding({ alias: "power_l1", value: 300 })]);
    expect(extractPhases([eq])).toEqual([{ n: 1, power: 300 }]);
  });

  it("returns all three phases sorted by phase number", () => {
    const eq = makeEquipment("main", [
      makeBinding({ alias: "power_l3", value: 15 }),
      makeBinding({ alias: "power_l1", value: 268 }),
      makeBinding({ alias: "power_l2", value: 197 }),
    ]);
    expect(extractPhases([eq])).toEqual([
      { n: 1, power: 268 },
      { n: 2, power: 197 },
      { n: 3, power: 15 },
    ]);
  });

  it("excludes a phase whose bound value is not a number", () => {
    const eq = makeEquipment("main", [
      makeBinding({ alias: "power_l1", value: 268 }),
      makeBinding({ alias: "power_l2", value: null }),
    ]);
    expect(extractPhases([eq])).toEqual([{ n: 1, power: 268 }]);
  });

  it("sums the same phase across multiple main_energy_meter equipments", () => {
    const eq1 = makeEquipment("main1", [makeBinding({ alias: "power_l1", value: 100 })]);
    const eq2 = makeEquipment("main2", [makeBinding({ alias: "power_l1", value: 50 })]);
    expect(extractPhases([eq1, eq2])).toEqual([{ n: 1, power: 150 }]);
  });

  it("parses multi-digit phase numbers", () => {
    const eq = makeEquipment("main", [makeBinding({ alias: "power_l10", value: 42 })]);
    expect(extractPhases([eq])).toEqual([{ n: 10, power: 42 }]);
  });

  it("ignores aliases that don't match the power_l{n} pattern", () => {
    const eq = makeEquipment("main", [
      makeBinding({ alias: "power", value: 500 }),
      makeBinding({ alias: "energy", value: 1200 }),
      makeBinding({ alias: "power_l1", value: 300 }),
    ]);
    expect(extractPhases([eq])).toEqual([{ n: 1, power: 300 }]);
  });
});

describe("formatPhasePower", () => {
  it("rounds sub-1000W values to the nearest 5W", () => {
    expect(formatPhasePower(268)).toEqual({ num: "270", unit: "W" });
  });

  it("formats >=1000W values in kW with one decimal", () => {
    expect(formatPhasePower(1234)).toEqual({ num: "1.2", unit: "kW" });
  });
});
