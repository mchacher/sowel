import { describe, it, expect } from "vitest";
import {
  CANDIDATE_BASED_TYPES,
  computeBindingCandidates,
  hasFreeCandidates,
  inferBindingCategory,
} from "./binding-candidates.js";
import type { DeviceData, DeviceOrder } from "./types.js";

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

  // Regression test for the bug found while setting up Bubendorff shutters
  // (sowel-plugin-legrand-control): that integration's device data/orders
  // are named current_position/target_position/state — NOT shutter_state/
  // shutter_position — so extractShutterGroupKey() matched nothing and the
  // "Create equipment" manual picker had zero candidates to auto-bind,
  // silently creating an equipment with no bindings at all (shown as
  // offline). The category-based fallback below fixes this without
  // affecting the Tasmota-style indexed convention tested above.
  it("shutter with Legrand/Bubendorff-style keys (current_position/target_position/state) → one candidate via category fallback", () => {
    const orders = [
      order("target_position", "number", { category: "set_shutter_position", min: 0, max: 100 }),
      order("state", "text", { category: "shutter_move", enumValues: ["OPEN", "CLOSE"] }),
    ];
    const datas = [data("current_position", "number", { category: "shutter_position" })];
    const result = computeBindingCandidates("shutter", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shutter1");
    expect(result[0].orderKeys.sort()).toEqual(["state", "target_position"]);
    expect(result[0].dataKeys).toEqual(["current_position"]);
  });

  it("shutter with Legrand/Bubendorff-style keys but no position data → still binds the order-only candidate", () => {
    // Some modules (none currently, but defensive) might expose only an
    // order with no matching position data — should not be dropped.
    const orders = [
      order("target_position", "number", { category: "set_shutter_position", min: 0, max: 100 }),
    ];
    const result = computeBindingCandidates("shutter", [], orders);
    expect(result).toHaveLength(1);
    expect(result[0].dataKeys).toEqual([]);
    expect(result[0].orderKeys).toEqual(["target_position"]);
  });

  it("shutter with neither key-name nor category match → no candidates (unchanged behavior)", () => {
    const orders = [order("foo", "number", { category: "generic" })];
    const result = computeBindingCandidates("shutter", [], orders);
    expect(result).toHaveLength(0);
  });

  it("shutter prefers the Tasmota-style key grouping over the category fallback when both are present", () => {
    // If a device somehow matches the indexed key convention, that grouping
    // wins and the category fallback never runs (byGroup.size > 0 guard).
    const orders = [
      order("shutter_state", "enum", { enumValues: ["OPEN", "CLOSE", "STOP"] }),
      order("shutter_position", "number", { min: 0, max: 100 }),
      // An unrelated category-matching order that would otherwise trigger
      // the fallback if it ran — it must NOT be picked up here.
      order("target_position", "number", { category: "set_shutter_position" }),
    ];
    const datas = [data("shutter_state", "enum"), data("shutter_position", "number")];
    const result = computeBindingCandidates("shutter", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys.sort()).toEqual(["shutter_position", "shutter_state"]);
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

  // A Zigbee relay (Tuya WHD02) exposes on/off as a boolean `state` order
  // (category light_toggle), not an ON/OFF enum. It bound to `switch` but was
  // silently excluded from `light_onoff` (isOnOffEnum-only) → could not drive
  // a light. Now accepted, same rule as `switch`.
  it("light_onoff on a Zigbee relay (boolean light_toggle `state`) → one candidate", () => {
    const orders = [
      order("state", "boolean", { category: "light_toggle" }),
      order("power_on_behavior", "enum", { enumValues: ["off", "previous", "on"] }),
    ];
    const datas = [data("state", "boolean", { category: "light_state", value: "OFF" })];
    const result = computeBindingCandidates("light_onoff", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys).toEqual(["state"]);
    expect(result[0].dataKeys).toEqual(["state"]);
  });

  it("pool_pump on a Zigbee relay (boolean light_toggle `state`) → one candidate", () => {
    const orders = [order("state", "boolean", { category: "light_toggle" })];
    const datas = [data("state", "boolean", { category: "light_state", value: "OFF" })];
    const result = computeBindingCandidates("pool_pump", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys).toEqual(["state"]);
  });

  it("light_onoff ignores a non-power boolean toggle (config switch)", () => {
    const orders = [order("child_lock", "boolean", { category: "toggle_lock" })];
    const result = computeBindingCandidates("light_onoff", [], orders);
    expect(result).toHaveLength(0);
  });

  // Spec 135 — water heater: same candidate shape as a switch.
  it("water_heater on a Zigbee relay (boolean light_toggle `state`) → one candidate", () => {
    const orders = [
      order("state", "boolean", { category: "light_toggle" }),
      order("power_on_behavior", "enum", { enumValues: ["off", "previous", "on"] }),
    ];
    const datas = [data("state", "boolean", { category: "light_state", value: "OFF" })];
    const result = computeBindingCandidates("water_heater", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys).toEqual(["state"]);
    expect(result[0].dataKeys).toEqual(["state"]);
  });

  it("water_heater on a metering relay → attaches power/energy to the candidate", () => {
    const orders = [order("state", "boolean", { category: "light_toggle" })];
    const datas = [
      data("state", "boolean", { category: "light_state", value: "ON" }),
      data("power", "number", { category: "power", value: 1800 }),
      data("energy", "number", { category: "energy", value: 12.4 }),
    ];
    const result = computeBindingCandidates("water_heater", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].dataKeys.sort()).toEqual(["energy", "power", "state"]);
  });

  it("water_heater with an ON/OFF enum `state` (Tasmota relay) → one candidate", () => {
    const orders = [order("state", "enum", { enumValues: ["ON", "OFF"] })];
    const datas = [data("state", "enum", { category: "light_state" })];
    const result = computeBindingCandidates("water_heater", datas, orders);
    expect(result).toHaveLength(1);
  });

  it("water_heater ignores a device with no on/off channel", () => {
    const orders = [order("child_lock", "boolean", { category: "toggle_lock" })];
    const result = computeBindingCandidates("water_heater", [], orders);
    expect(result).toHaveLength(0);
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

describe("gate candidates (spec 150)", () => {
  it("boolean relay (Zigbee dry-contact, e.g. SONOFF MINI-ZBD) → one command candidate", () => {
    const orders = [
      order("state", "boolean", { category: "light_toggle" }),
      // Writable config exposes must NOT become gate candidates
      order("power_on_behavior", "enum", { enumValues: ["off", "on", "toggle", "previous"] }),
      order("turbo_mode", "boolean"),
      order("detach_relay_mode", "boolean"),
    ];
    const datas = [
      data("state", "boolean", { category: "light_state" }),
      data("turbo_mode", "boolean"),
      data("detach_relay_mode", "boolean"),
    ];
    const result = computeBindingCandidates("gate", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("state");
    expect(result[0].orderKeys).toEqual(["state"]);
    // The relay's own state feedback is NOT bound (alias collision with the
    // virtual gate state + zone lights-on pollution via light_state).
    expect(result[0].dataKeys).toEqual([]);
  });

  it("ON/OFF enum relay (Tasmota) → one command candidate", () => {
    const orders = [order("power1", "enum", { enumValues: ["ON", "OFF"] })];
    const result = computeBindingCandidates("gate", [], orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys).toEqual(["power1"]);
  });

  it("Somfy RTS gate_trigger order → one candidate (unchanged)", () => {
    const orders = [order("gate_trigger", "enum", { category: "gate_trigger" })];
    const result = computeBindingCandidates("gate", [], orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("gate_trigger");
  });

  it("LoRa controller (R1 relay + RS reed data) → candidate carries the reed feedback", () => {
    const orders = [order("R1", "enum", { enumValues: ["ON", "OFF"] })];
    const datas = [data("RS1", "number"), data("vcc", "number", { category: "voltage" })];
    const result = computeBindingCandidates("gate", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys).toEqual(["R1"]);
    expect(result[0].dataKeys).toEqual(["RS1"]);
  });

  it("contact-only sensor (SNZB-04P) → one data-only contact candidate", () => {
    const datas = [
      data("contact", "boolean", { category: "contact_door" }),
      data("battery", "number", { category: "battery" }),
    ];
    const result = computeBindingCandidates("gate", datas, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("contact");
    expect(result[0].orderKeys).toEqual([]);
    expect(result[0].dataKeys).toEqual(["contact"]);
  });

  it("data-only device without contact/reed (e.g. a temperature sensor) → no candidate", () => {
    const datas = [
      data("temperature", "number", { category: "temperature" }),
      data("position", "number", { category: "generic" }),
    ];
    expect(computeBindingCandidates("gate", datas, [])).toHaveLength(0);
  });

  it("data-only reed board (RS keys) → contact candidate", () => {
    const datas = [data("RS1", "number"), data("vcc", "number", { category: "voltage" })];
    const result = computeBindingCandidates("gate", datas, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("contact");
    expect(result[0].dataKeys).toEqual(["RS1"]);
  });

  it("device with only config orders and no data → no candidate", () => {
    const orders = [
      order("power_on_behavior", "enum", { enumValues: ["off", "on", "toggle", "previous"] }),
    ];
    expect(computeBindingCandidates("gate", [], orders)).toHaveLength(0);
  });
});

describe("dimmable/color lights accept boolean relays (spec 150)", () => {
  it("light_dimmable with boolean state + brightness → one candidate", () => {
    const orders = [
      order("state", "boolean", { category: "light_toggle" }),
      order("brightness", "number", { category: "set_brightness", min: 0, max: 254 }),
    ];
    const datas = [
      data("state", "boolean", { category: "light_state" }),
      data("brightness", "number", { category: "light_brightness" }),
    ];
    const result = computeBindingCandidates("light_dimmable", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys.sort()).toEqual(["brightness", "state"]);
    expect(result[0].dataKeys.sort()).toEqual(["brightness", "state"]);
  });

  it("light_color with boolean state + color orders → candidate includes color keys", () => {
    const orders = [
      order("state", "boolean", { category: "light_toggle" }),
      order("brightness", "number", { category: "set_brightness" }),
      order("color_temp", "number", { category: "set_color_temp" }),
      order("color", "json", { category: "set_color" }),
    ];
    const datas = [data("state", "boolean", { category: "light_state" })];
    const result = computeBindingCandidates("light_color", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys.sort()).toEqual(["brightness", "color", "color_temp", "state"]);
  });
});

describe("CANDIDATE_BASED_TYPES coverage (spec 150)", () => {
  it("every candidate-based type has a dedicated implementation (never the 'all' fallback)", () => {
    // A candidate-based type falling through to the default "all" case would
    // recreate the pre-150 divergence bug (UI offering junk or nothing).
    // The default case is recognizable: single candidate id "all" grabbing
    // every key including config junk, for ANY input.
    const junkOrders = [
      order("power_on_behavior", "enum", { enumValues: ["off", "on", "toggle", "previous"] }),
    ];
    for (const t of CANDIDATE_BASED_TYPES) {
      const result = computeBindingCandidates(t, [], junkOrders);
      const isDefaultShape =
        result.length === 1 && result[0].id === "all" && result[0].orderKeys.length === 1;
      expect(isDefaultShape, `type ${t} fell through to the default case`).toBe(false);
    }
  });
});
