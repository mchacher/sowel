import { describe, it, expect } from "vitest";
import type { EquipmentWithDetails } from "../types";
import { isMeteringSwitch, isSubmeterEquipment } from "./metering";

function eq(
  type: EquipmentWithDetails["type"],
  bindings: { alias: string; category?: string; type?: "number" | "boolean" }[],
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
      type: b.type ?? "number",
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

const power = [{ alias: "power", category: "power" }];
const energy = [{ alias: "energy", category: "energy" }];
const relayState = [{ alias: "state", category: "light_state", type: "boolean" as const }];
const booleanPower = [{ alias: "power", category: "power", type: "boolean" as const }];

describe("metering (UI) — spec 129 / #523", () => {
  it("isMeteringSwitch: switch/water_heater card concern is unchanged (spec 129)", () => {
    expect(isMeteringSwitch(eq("switch", power))).toBe(true);
    expect(isMeteringSwitch(eq("switch", energy))).toBe(true);
    expect(isMeteringSwitch(eq("switch", relayState))).toBe(false);
    expect(isMeteringSwitch(eq("light_onoff", power))).toBe(false);
    expect(isMeteringSwitch(eq("water_heater", power))).toBe(true); // #521
    expect(isMeteringSwitch(eq("water_heater", relayState))).toBe(false);
  });

  it("isSubmeterEquipment: ANY numeric-metered load except house/production (#523)", () => {
    // The headline: a metering thermostat (the AC on its clamp) now enrols.
    expect(isSubmeterEquipment(eq("thermostat", power))).toBe(true);
    // Numeric gate: the thermostat's own boolean on/off must NOT enrol it.
    expect(isSubmeterEquipment(eq("thermostat", booleanPower))).toBe(false);

    // Generic metered loads enrol without a per-type whitelist.
    expect(isSubmeterEquipment(eq("appliance", energy))).toBe(true);
    expect(isSubmeterEquipment(eq("pool_pump", power))).toBe(true);

    // Still-valid prior cases.
    expect(isSubmeterEquipment(eq("energy_meter", power))).toBe(true);
    expect(isSubmeterEquipment(eq("switch", power))).toBe(true);
    expect(isSubmeterEquipment(eq("water_heater", power))).toBe(true);
    // A declared energy_meter qualifies on type alone (card renders at 0, #527).
    expect(isSubmeterEquipment(eq("energy_meter", []))).toBe(true);

    // A non-meter load with no numeric channel → not a submeter.
    expect(isSubmeterEquipment(eq("thermostat", []))).toBe(false);
    expect(isSubmeterEquipment(eq("switch", relayState))).toBe(false);

    // The three exclusions.
    expect(isSubmeterEquipment(eq("main_energy_meter", power))).toBe(false);
    expect(isSubmeterEquipment(eq("energy_production_meter", power))).toBe(false);
    expect(isSubmeterEquipment(eq("solar_panel", power))).toBe(false);
  });
});
