import { describe, expect, it } from "vitest";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { isRunning } from "./equipment-running";

// Spec 208, FR4 — when a tile takes the full colour of its family.

function binding(alias: string, value: unknown, category?: string, type = "boolean") {
  return {
    id: `db-${alias}`,
    equipmentId: "eq-1",
    deviceDataId: `dd-${alias}`,
    alias,
    deviceId: "dev-1",
    deviceName: "Device",
    key: alias,
    type,
    category,
    value,
    lastUpdated: "2026-11-14T08:00:00Z",
  };
}

function eq(
  type: EquipmentType,
  bindings: ReturnType<typeof binding>[] = [],
  over: Partial<EquipmentWithDetails> = {},
): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Equipment",
    zoneId: "z-1",
    type,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: bindings as EquipmentWithDetails["dataBindings"],
    orderBindings: [],
    ...over,
  };
}

const state = (value: unknown) => binding("state", value, "light_state");

describe("isRunning (spec 208)", () => {
  it("follows the on/off state of a light", () => {
    expect(isRunning(eq("light_onoff", [state(true)]))).toBe(true);
    expect(isRunning(eq("light_dimmable", [state("ON")]))).toBe(true);
    expect(isRunning(eq("light_onoff", [state(false)]))).toBe(false);
    // As the power button reads it: « on » in any case.
    expect(isRunning(eq("light_onoff", [state("on")]))).toBe(true);
  });

  it("follows the relay of a valve, a pump, a water heater and a plug", () => {
    for (const type of ["water_valve", "pool_pump", "water_heater", "switch"] as const) {
      expect(isRunning(eq(type, [state(true)]))).toBe(true);
      expect(isRunning(eq(type, [state(false)]))).toBe(false);
    }
  });

  it("reads a pilot-wire radiator as running in comfort (relay off)", () => {
    expect(isRunning(eq("heater", [state(false)]))).toBe(true);
    expect(isRunning(eq("heater", [state(true)]))).toBe(false);
    // « on » in lower case is éco, as the badge reads it.
    expect(isRunning(eq("heater", [state("on")]))).toBe(false);
    // No state reading: the badge says « Confort », and so does the tile.
    expect(isRunning(eq("heater"))).toBe(true);
  });

  it("follows a thermostat's power and a pool heat pump's mode", () => {
    expect(isRunning(eq("thermostat", [binding("state", true)]))).toBe(true);
    expect(isRunning(eq("thermostat", [binding("state", false)]))).toBe(false);
    expect(isRunning(eq("pool_heat_pump", [binding("mode", "OFF", undefined, "enum")]))).toBe(
      false,
    );
    expect(isRunning(eq("pool_heat_pump", [binding("mode", "HEAT", undefined, "enum")]))).toBe(
      true,
    );
  });

  it("reads a VMC as running at any speed but off", () => {
    expect(isRunning(eq("vmc", [binding("low", false), binding("high", false)]))).toBe(false);
    expect(isRunning(eq("vmc", [binding("low", true), binding("high", false)]))).toBe(true);
  });

  it("reads a charger and a vehicle as running while charging", () => {
    const charger = (v: string) =>
      eq("ev_charger", [binding("vehicle", v, "ev_vehicle_state", "enum")]);
    expect(isRunning(charger("charging"))).toBe(true);
    expect(isRunning(charger("connected"))).toBe(false);
    const car = (v: string) =>
      eq("electric_vehicle", [binding("charging_state", v, "ev_charging_state", "enum")]);
    expect(isRunning(car("charging"))).toBe(true);
    expect(isRunning(car("idle"))).toBe(false);
  });

  it("never runs a shutter, a sensor, a meter or an equipment with no state", () => {
    expect(isRunning(eq("shutter", [binding("position", 100, "shutter_position", "number")]))).toBe(
      false,
    );
    expect(isRunning(eq("sensor", [binding("occupancy", true, "motion")]))).toBe(false);
    expect(isRunning(eq("energy_meter", [binding("power", 1200, "power", "number")]))).toBe(false);
    expect(isRunning(eq("light_onoff"))).toBe(false);
    expect(isRunning(eq("switch"))).toBe(false);
  });
});
