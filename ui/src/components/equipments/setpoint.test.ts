import { describe, it, expect } from "vitest";
import type { EquipmentWithDetails } from "../../types";
import {
  CLOUD_COMMIT_DELAY_MS,
  LOCAL_COMMIT_DELAY_MS,
  resolveSetpoint,
  setpointCommitDelay,
  setpointLevel,
  setpointOwnerIsOff,
  setpointStateLine,
  zoneSetpointBounds,
} from "./setpoint";

function eq(partial: {
  type?: string;
  data?: { alias: string; value: unknown; category?: string; type?: string }[];
  orders?: { alias: string; deviceId?: string; category?: string; min?: number; max?: number }[];
}): EquipmentWithDetails {
  return {
    id: "eq",
    name: "Eq",
    type: partial.type ?? "thermostat",
    enabled: true,
    dataBindings: (partial.data ?? []).map((d) => ({ deviceId: "dev-1", ...d })),
    orderBindings: (partial.orders ?? []).map((o) => ({ deviceId: "dev-1", ...o })),
  } as unknown as EquipmentWithDetails;
}

describe("setpointCommitDelay (spec 196, slice 8a)", () => {
  const devices = {
    "dev-pac": { integrationId: "panasonic_cc" },
    "dev-z2m": { integrationId: "zigbee2mqtt" },
    "dev-modbus": { integrationId: "polytropic_master" },
  };

  it("waits ~600 ms for a cloud device and ~150 ms for a local one", () => {
    expect(
      setpointCommitDelay(eq({ orders: [{ alias: "setpoint", deviceId: "dev-pac" }] }), devices),
    ).toBe(CLOUD_COMMIT_DELAY_MS);
    expect(
      setpointCommitDelay(eq({ orders: [{ alias: "setpoint", deviceId: "dev-z2m" }] }), devices),
    ).toBe(LOCAL_COMMIT_DELAY_MS);
    // Polling is not cloud: the Modbus pool heat pump is on the local network.
    expect(
      setpointCommitDelay(eq({ orders: [{ alias: "setpoint", deviceId: "dev-modbus" }] }), devices),
    ).toBe(LOCAL_COMMIT_DELAY_MS);
    expect(CLOUD_COMMIT_DELAY_MS).toBe(600);
    expect(LOCAL_COMMIT_DELAY_MS).toBe(150);
  });

  it("takes the cloud delay for a device it does not know yet", () => {
    expect(
      setpointCommitDelay(eq({ orders: [{ alias: "setpoint", deviceId: "dev-?" }] }), devices),
    ).toBe(CLOUD_COMMIT_DELAY_MS);
  });

  it("takes the cloud delay for a zone when one of its thermostats is cloud", () => {
    const local = eq({ orders: [{ alias: "setpoint", deviceId: "dev-z2m" }] });
    const cloud = eq({ orders: [{ alias: "setpoint", deviceId: "dev-pac" }] });
    expect(setpointCommitDelay([local], devices)).toBe(LOCAL_COMMIT_DELAY_MS);
    expect(setpointCommitDelay([local, cloud], devices)).toBe(CLOUD_COMMIT_DELAY_MS);
  });
});

describe("resolveSetpoint", () => {
  it("reads a thermostat's core alias with the order's bounds", () => {
    const s = resolveSetpoint(
      eq({
        data: [{ alias: "setpoint", value: 21 }],
        orders: [{ alias: "setpoint", min: 5, max: 35 }],
      }),
    );
    expect(s).toEqual({ value: 21, order: "setpoint", min: 5, max: 35, step: 0.5 });
  });

  it("defaults a thermostat to 16–30 and a pool heat pump to 10–30", () => {
    expect(resolveSetpoint(eq({ orders: [{ alias: "setpoint" }] }))).toMatchObject({
      min: 16,
      max: 30,
      value: null,
    });
    expect(
      resolveSetpoint(eq({ type: "pool_heat_pump", orders: [{ alias: "setpoint" }] })),
    ).toMatchObject({
      min: 10,
      max: 30,
    });
  });

  it("reads a pool heat pump by category first", () => {
    const s = resolveSetpoint(
      eq({
        type: "pool_heat_pump",
        data: [{ alias: "target_temp", value: 28, category: "pool_temperature_setpoint" }],
        orders: [{ alias: "set_target", category: "set_pool_temperature_setpoint" }],
      }),
    );
    expect(s.value).toBe(28);
    expect(s.order).toBe("set_target");
  });

  it("gives a zone the widest bounds of its thermostats", () => {
    expect(
      zoneSetpointBounds([
        eq({ orders: [{ alias: "setpoint", min: 16, max: 30 }] }),
        eq({ orders: [{ alias: "setpoint", min: 5, max: 28 }] }),
      ]),
    ).toEqual({ min: 5, max: 30 });
    expect(zoneSetpointBounds([])).toEqual({ min: 16, max: 30 });
  });
});

describe("setpointLevel (thermometer)", () => {
  it("places the setpoint between the bounds", () => {
    expect(setpointLevel(23, 16, 30)).toBe(0.5);
  });
  it("draws nothing without a value or without a range", () => {
    expect(setpointLevel(null, 16, 30)).toBeUndefined();
    expect(setpointLevel(20, 20, 20)).toBeUndefined();
    expect(setpointLevel(20, 30, 16)).toBeUndefined();
  });
});

describe("setpointStateLine (mobile card)", () => {
  it("shows the temperature, then the setpoint", () => {
    expect(setpointStateLine(21, 20, false, "Off")).toBe("21.0° → 20.0°");
  });
  it("says the thermostat is off rather than a setpoint it does not follow", () => {
    expect(setpointStateLine(21, 20, true, "Off")).toBe("21.0° · off");
  });
  it("shows the temperature alone without a setpoint", () => {
    expect(setpointStateLine(21, null, false, "Off")).toBe("21.0°");
  });
  it("shows a dash for a temperature not reported yet", () => {
    expect(setpointStateLine(null, 20, false, "Off")).toBe("\u2014 → 20.0°");
  });
  it("takes off only from a reported run state", () => {
    expect(setpointOwnerIsOff(eq({ data: [{ alias: "state", value: false }] }))).toBe(true);
    expect(setpointOwnerIsOff(eq({ data: [{ alias: "state", value: true }] }))).toBe(false);
    expect(setpointOwnerIsOff(eq({ data: [] }))).toBe(false);
    expect(
      setpointOwnerIsOff(eq({ type: "pool_heat_pump", data: [{ alias: "mode", value: "OFF" }] })),
    ).toBe(true);
  });
});
