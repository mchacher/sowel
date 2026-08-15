import { describe, it, expect } from "vitest";
import type { EquipmentWithDetails } from "../types";
import { isMeteringSwitch, isSubmeterEquipment } from "./metering";

function eq(
  type: EquipmentWithDetails["type"],
  bindings: { alias: string; category?: string }[],
): EquipmentWithDetails {
  return {
    id: "e",
    name: "E",
    zoneId: "z",
    type,
    enabled: true,
    createdAt: "2026-05-01 00:00:00Z",
    updatedAt: "2026-05-01 00:00:00Z",
    dataBindings: bindings.map((b) => ({
      id: "b-" + b.alias,
      equipmentId: "e",
      deviceDataId: "dd",
      deviceId: "d",
      deviceName: "D",
      key: b.alias,
      alias: b.alias,
      type: "number",
      category: (b.category ?? "generic") as EquipmentWithDetails["dataBindings"][number]["category"],
      value: 0,
      lastUpdated: null,
      lastChanged: null,
      stale: false,
    })),
    orderBindings: [],
    status: "online",
  } as EquipmentWithDetails;
}

describe("metering (UI) — spec 129", () => {
  it("isMeteringSwitch: switch with power/energy only", () => {
    expect(isMeteringSwitch(eq("switch", [{ alias: "power", category: "power" }]))).toBe(true);
    expect(isMeteringSwitch(eq("switch", [{ alias: "energy", category: "energy" }]))).toBe(true);
    expect(isMeteringSwitch(eq("switch", [{ alias: "state", category: "light_state" }]))).toBe(false);
    expect(isMeteringSwitch(eq("light_onoff", [{ alias: "power", category: "power" }]))).toBe(false);
  });

  it("isMeteringSwitch: water_heater with power/energy is a metering relay (#521)", () => {
    expect(isMeteringSwitch(eq("water_heater", [{ alias: "power", category: "power" }]))).toBe(true);
    expect(isMeteringSwitch(eq("water_heater", [{ alias: "energy", category: "energy" }]))).toBe(true);
    expect(isMeteringSwitch(eq("water_heater", [{ alias: "state", category: "light_state" }]))).toBe(false);
  });

  it("isSubmeterEquipment: energy_meter or metering relay", () => {
    expect(isSubmeterEquipment(eq("energy_meter", []))).toBe(true);
    expect(isSubmeterEquipment(eq("switch", [{ alias: "power", category: "power" }]))).toBe(true);
    expect(isSubmeterEquipment(eq("switch", [{ alias: "state", category: "light_state" }]))).toBe(false);
    expect(isSubmeterEquipment(eq("water_heater", [{ alias: "power", category: "power" }]))).toBe(true);
    expect(isSubmeterEquipment(eq("water_heater", [{ alias: "state", category: "light_state" }]))).toBe(false);
    expect(isSubmeterEquipment(eq("main_energy_meter", [{ alias: "power", category: "power" }]))).toBe(false);
  });
});
