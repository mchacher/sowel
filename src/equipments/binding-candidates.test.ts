import { describe, it, expect } from "vitest";
import {
  computeBindingCandidates,
  hasFreeCandidates,
  inferBindingCategory,
} from "./binding-candidates.js";
import type { DeviceData, DeviceOrder } from "../shared/types.js";

function order(
  key: string,
  type: DeviceOrder["type"],
  extra: Partial<DeviceOrder> = {},
): DeviceOrder {
  return {
    id: key,
    deviceId: "DEV",
    key,
    type,
    ...extra,
  };
}

function data(key: string, type: DeviceData["type"], extra: Partial<DeviceData> = {}): DeviceData {
  return {
    id: key,
    deviceId: "DEV",
    key,
    type,
    category: "generic",
    value: null,
    lastUpdated: null,
    ...extra,
  };
}

describe("computeBindingCandidates", () => {
  it("pool_pump on a 4-relay enum device → one candidate per relay", () => {
    const orders = [
      order("R1", "enum", { enumValues: ["ON", "OFF"] }),
      order("R2", "enum", { enumValues: ["ON", "OFF"] }),
      order("R3", "enum", { enumValues: ["ON", "OFF"] }),
      order("R4", "enum", { enumValues: ["ON", "OFF"] }),
    ];
    const datas = orders.map((o) => data(o.key, "enum"));
    const result = computeBindingCandidates("pool_pump", datas, orders);
    expect(result).toHaveLength(4);
    expect(result.map((c) => c.id)).toEqual(["R1", "R2", "R3", "R4"]);
    expect(result[0].orderKeys).toEqual(["R1"]);
    expect(result[0].dataKeys).toEqual(["R1"]);
  });

  it("pool_cover with shutter_state + shutter_position → one candidate", () => {
    const orders = [
      order("shutter_state", "enum", { enumValues: ["OPEN", "CLOSE", "STOP"] }),
      order("shutter_position", "number", { min: 0, max: 100 }),
    ];
    const datas = [data("shutter_state", "enum"), data("shutter_position", "number")];
    const result = computeBindingCandidates("pool_cover", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shutter1");
    expect(result[0].orderKeys.sort()).toEqual(["shutter_position", "shutter_state"]);
    expect(result[0].dataKeys.sort()).toEqual(["shutter_position", "shutter_state"]);
  });

  it("awning with shutter_state + shutter_position → one candidate (mirrors shutter)", () => {
    const orders = [
      order("shutter_state", "enum", { enumValues: ["OPEN", "CLOSE", "STOP"] }),
      order("shutter_position", "number", { min: 0, max: 100 }),
    ];
    const datas = [data("shutter_state", "enum"), data("shutter_position", "number")];
    const result = computeBindingCandidates("awning", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shutter1");
    expect(result[0].orderKeys.sort()).toEqual(["shutter_position", "shutter_state"]);
    expect(result[0].dataKeys.sort()).toEqual(["shutter_position", "shutter_state"]);
  });

  it("switch on a single-relay device → one candidate", () => {
    const orders = [order("R1", "enum", { enumValues: ["ON", "OFF"] })];
    const datas = [data("R1", "enum")];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("R1");
  });

  // Regression: Zigbee2MQTT plugs (e.g. LidlSmartPlug) expose their on/off
  // command as a boolean `state` order (category light_toggle), not an ON/OFF
  // enum. Such devices must still yield a switch candidate.
  it("switch on a Zigbee plug (boolean light_toggle `state`) → one candidate", () => {
    const orders = [
      order("state", "boolean", { category: "light_toggle" }),
      order("indicator_mode", "enum", { enumValues: ["off", "off/on", "on/off", "on"] }),
      order("power_on_behavior", "enum", { enumValues: ["off", "previous", "on"] }),
    ];
    const datas = [data("state", "boolean", { category: "light_state", value: "OFF" })];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("state");
    expect(result[0].orderKeys).toEqual(["state"]);
    expect(result[0].dataKeys).toEqual(["state"]);
  });

  it("switch ignores boolean config toggles (no / non power-toggle category)", () => {
    const orders = [
      order("power_alarm", "boolean"),
      order("mute", "boolean", { category: "toggle_mute" }),
    ];
    const result = computeBindingCandidates("switch", [], orders);
    expect(result).toHaveLength(0);
  });

  // Spec 129 — metering-aware switch (SONOFF S60ZBTPF etc.)
  it("metering plug (state + power/energy/voltage/current) → binds on/off + metering", () => {
    const orders = [order("state", "boolean", { category: "light_toggle" })];
    const datas = [
      data("state", "boolean", { category: "light_state", value: "ON" }),
      data("power", "number", { category: "power", value: 42 }),
      data("energy", "number", { category: "energy", value: 1.5 }),
      data("voltage", "number", { category: "voltage", value: 230 }),
      data("current", "number", { category: "current", value: 0.2 }),
      data("linkquality", "number", { category: "generic", value: 100 }),
    ];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys).toEqual(["state"]);
    expect(result[0].dataKeys.sort()).toEqual(["current", "energy", "power", "state", "voltage"]);
  });

  it("metering plug reporting power but not energy → binds power", () => {
    const orders = [order("state", "boolean", { category: "light_toggle" })];
    const datas = [
      data("state", "boolean", { category: "light_state", value: "ON" }),
      data("power", "number", { category: "power", value: 42 }),
    ];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result[0].dataKeys.sort()).toEqual(["power", "state"]);
  });

  it("bare relay (state only) → no metering attached (unchanged)", () => {
    const orders = [order("state", "boolean", { category: "light_toggle" })];
    const datas = [data("state", "boolean", { category: "light_state", value: "OFF" })];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result[0].dataKeys).toEqual(["state"]);
  });

  it("multi-gang switch (2 channels) → metering NOT auto-attached", () => {
    const orders = [
      order("state_left", "boolean", { category: "light_toggle" }),
      order("state_right", "boolean", { category: "light_toggle" }),
    ];
    const datas = [
      data("state_left", "boolean", { category: "light_state" }),
      data("state_right", "boolean", { category: "light_state" }),
      data("power", "number", { category: "power", value: 10 }),
    ];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result).toHaveLength(2);
    expect(result.flatMap((c) => c.dataKeys)).not.toContain("power");
  });

  it("light_onoff with power data → metering NOT attached (switch-only feature)", () => {
    const orders = [order("state", "enum", { enumValues: ["ON", "OFF"] })];
    const datas = [
      data("state", "enum", { category: "light_state" }),
      data("power", "number", { category: "power", value: 5 }),
    ];
    const result = computeBindingCandidates("light_onoff", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].dataKeys).toEqual(["state"]);
  });

  it("sensor on a multi-data device → one all-data candidate", () => {
    const datas = [
      data("temperature", "number", { category: "temperature" }),
      data("humidity", "number", { category: "humidity" }),
      data("pressure", "number", { category: "pressure" }),
    ];
    const result = computeBindingCandidates("sensor", datas, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("all");
    expect(result[0].dataKeys).toEqual(["temperature", "humidity", "pressure"]);
    expect(result[0].orderKeys).toEqual([]);
  });

  // Spec 120 — display equipment polymorphism.
  it("display with all telemetry → one all-data candidate", () => {
    const datas = [
      data("version", "text", { category: "firmware_version" }),
      data("uptime", "number", { category: "uptime" }),
      data("rssi", "number", { category: "rssi" }),
      data("language", "text", { category: "language" }),
      data("brightness", "number", { category: "display_brightness" }),
    ];
    const orders = [order("set_language", "text"), order("set_brightness", "number")];
    const result = computeBindingCandidates("display", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("all");
    expect(result[0].dataKeys).toEqual(["version", "uptime", "rssi", "language", "brightness"]);
    expect(result[0].orderKeys).toEqual(["set_language", "set_brightness"]);
  });

  it("display with only mandatory fields (version + uptime) → still bindable", () => {
    const datas = [
      data("version", "text", { category: "firmware_version" }),
      data("uptime", "number", { category: "uptime" }),
    ];
    const result = computeBindingCandidates("display", datas, []);
    expect(result).toHaveLength(1);
    expect(result[0].dataKeys).toEqual(["version", "uptime"]);
    expect(result[0].orderKeys).toEqual([]);
  });

  it("display with no data + no orders → no candidate (cannot bind to nothing)", () => {
    const result = computeBindingCandidates("display", [], []);
    expect(result).toHaveLength(0);
  });

  // ── solar_panel (spec 125) — one candidate per inverter channel ──

  function inverterData(channels: number, withTemp = true): DeviceData[] {
    const d: DeviceData[] = [
      data("power", "number", { category: "power" }),
      data("energy", "number", { category: "energy" }),
      data("ac_voltage", "number", { category: "voltage" }),
      data("frequency", "number", { category: "generic" }),
      data("signal", "number", { category: "rssi" }),
    ];
    if (withTemp) d.push(data("inverter_temp", "number", { category: "temperature_device" }));
    for (let n = 1; n <= channels; n++) {
      d.push(
        data(`ch${n}_voltage`, "number", { category: "voltage" }),
        data(`ch${n}_current`, "number", { category: "current" }),
        data(`ch${n}_power`, "number", { category: "power" }),
        data(`ch${n}_energy`, "number", { category: "energy" }),
      );
    }
    return d;
  }

  it("solar_panel on a 2-channel inverter → 2 candidates, each = channel metrics + inverter_temp", () => {
    const result = computeBindingCandidates("solar_panel", inverterData(2), []);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["ch1", "ch2"]);
    expect(result[0].dataKeys).toEqual([
      "ch1_voltage",
      "ch1_current",
      "ch1_power",
      "ch1_energy",
      "inverter_temp",
    ]);
    expect(result[1].dataKeys).toEqual([
      "ch2_voltage",
      "ch2_current",
      "ch2_power",
      "ch2_energy",
      "inverter_temp",
    ]);
    expect(result[0].orderKeys).toEqual([]);
  });

  it("solar_panel on a single-channel inverter → 1 candidate incl. inverter_temp", () => {
    const result = computeBindingCandidates("solar_panel", inverterData(1), []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ch1");
    expect(result[0].dataKeys).toContain("inverter_temp");
    expect(result[0].dataKeys).toHaveLength(5);
  });

  it("solar_panel with a channel but no inverter_temp → channel metrics only", () => {
    const result = computeBindingCandidates("solar_panel", inverterData(1, false), []);
    expect(result).toHaveLength(1);
    expect(result[0].dataKeys).toEqual(["ch1_voltage", "ch1_current", "ch1_power", "ch1_energy"]);
  });

  it("solar_panel with inverter-level keys only (no ch<N>_) → no candidate", () => {
    const datas = [
      data("power", "number", { category: "power" }),
      data("inverter_temp", "number", { category: "temperature_device" }),
    ];
    const result = computeBindingCandidates("solar_panel", datas, []);
    expect(result).toHaveLength(0);
  });
});

describe("hasFreeCandidates", () => {
  const orders = [
    order("R1", "enum", { enumValues: ["ON", "OFF"] }),
    order("R2", "enum", { enumValues: ["ON", "OFF"] }),
    order("R3", "enum", { enumValues: ["ON", "OFF"] }),
    order("R4", "enum", { enumValues: ["ON", "OFF"] }),
  ];
  const datas = orders.map((o) => data(o.key, "enum"));

  it("returns true when nothing is bound", () => {
    expect(hasFreeCandidates("pool_pump", datas, orders, new Set())).toBe(true);
  });

  it("returns true when only some candidates are bound", () => {
    const bound = new Set<string>(["R1", "R2"]);
    expect(hasFreeCandidates("pool_pump", datas, orders, bound)).toBe(true);
  });

  it("returns false when every candidate is bound", () => {
    const bound = new Set<string>(["R1", "R2", "R3", "R4"]);
    expect(hasFreeCandidates("pool_pump", datas, orders, bound)).toBe(false);
  });
});

describe("inferBindingCategory", () => {
  it("pool_pump + enum [ON,OFF] → pool_pump_toggle", () => {
    expect(inferBindingCategory("pool_pump", { type: "enum", enumValues: ["ON", "OFF"] })).toBe(
      "pool_pump_toggle",
    );
  });

  it("pool_cover + enum [OPEN,CLOSE,STOP] → pool_cover_move", () => {
    expect(
      inferBindingCategory("pool_cover", {
        type: "enum",
        enumValues: ["OPEN", "CLOSE", "STOP"],
      }),
    ).toBe("pool_cover_move");
  });

  it("pool_cover + number → pool_cover_position", () => {
    expect(inferBindingCategory("pool_cover", { type: "number", min: 0, max: 100 })).toBe(
      "pool_cover_position",
    );
  });

  it("switch + enum [ON,OFF] → null (no override)", () => {
    expect(inferBindingCategory("switch", { type: "enum", enumValues: ["ON", "OFF"] })).toBe(null);
  });
});
