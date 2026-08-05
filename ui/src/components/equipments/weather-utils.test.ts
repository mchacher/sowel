import { describe, expect, it } from "vitest";
import type { DataBindingWithValue, EquipmentWithDetails } from "../../types";
import { findTempExtremes } from "./weather-utils";

function binding(alias: string, category: string): DataBindingWithValue {
  return {
    id: "b-" + alias,
    equipmentId: "eq",
    deviceDataId: "dd-" + alias,
    deviceId: "d1",
    deviceName: "Station",
    alias,
    key: alias,
    type: "number",
    category: category as DataBindingWithValue["category"],
    value: 20,
    unit: "°C",
    lastUpdated: "2026-08-05 10:00:00Z",
    lastChanged: "2026-08-05 10:00:00Z",
    stale: false,
  };
}

function equipment(
  bindings: DataBindingWithValue[],
  computed: { alias: string; value: unknown }[],
): EquipmentWithDetails {
  return {
    id: "eq",
    name: "Station",
    zoneId: "z",
    type: "weather",
    enabled: true,
    createdAt: "2026-08-01 00:00:00Z",
    updatedAt: "2026-08-01 00:00:00Z",
    dataBindings: bindings,
    orderBindings: [],
    computedData: computed.map((c) => ({ ...c, lastUpdated: "2026-08-05 10:00:00Z" })),
    status: "online",
  };
}

describe("findTempExtremes", () => {
  it("resolves outdoor extremes via the source binding's alias", () => {
    const eq = equipment(
      [binding("temperature", "temperature_outdoor"), binding("temperature_2", "temperature")],
      [
        { alias: "temperature_min_today", value: 14.2 },
        { alias: "temperature_max_today", value: 27.5 },
        { alias: "temperature_2_min_today", value: 21 },
        { alias: "temperature_2_max_today", value: 25.5 },
      ],
    );
    expect(findTempExtremes(eq, "temperature_outdoor")).toEqual({ min: 14.2, max: 27.5 });
    expect(findTempExtremes(eq, "temperature")).toEqual({ min: 21, max: 25.5 });
  });

  it("returns null when a bound temperature has no computed extremes yet", () => {
    const eq = equipment([binding("temperature", "temperature_outdoor")], []);
    expect(findTempExtremes(eq, "temperature_outdoor")).toBeNull();
  });

  it("returns null when one bound is missing or non-numeric", () => {
    const eq = equipment(
      [binding("temperature", "temperature_outdoor")],
      [
        { alias: "temperature_min_today", value: 14.2 },
        { alias: "temperature_max_today", value: null },
      ],
    );
    expect(findTempExtremes(eq, "temperature_outdoor")).toBeNull();
  });

  it("returns null when the category is not bound on the equipment", () => {
    const eq = equipment(
      [binding("temperature_2", "temperature")],
      [{ alias: "temperature_min_today", value: 14.2 }],
    );
    expect(findTempExtremes(eq, "temperature_outdoor")).toBeNull();
  });
});
