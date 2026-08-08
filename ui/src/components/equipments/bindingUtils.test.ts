import { describe, it, expect } from "vitest";
import { isRelevantData, isRelevantOrder, resolveAlias } from "./bindingUtils";
import { findDataByCategory, findOrderByCategory } from "./bindingUtils";

describe("findOrderByCategory", () => {
  it("matches the first binding by category", () => {
    const bindings = [
      { alias: "state", category: "light_toggle" as const },
      { alias: "brightness", category: "set_brightness" as const },
    ];
    expect(findOrderByCategory(bindings, ["light_toggle"])).toEqual(bindings[0]);
  });

  it("matches any of several categories (covers pool_cover_move + shutter_move)", () => {
    const bindings = [
      { alias: "shutter_state", category: "pool_cover_move" as const },
    ];
    expect(
      findOrderByCategory(bindings, ["pool_cover_move", "shutter_move"]),
    ).toEqual(bindings[0]);
  });

  it("returns the binding regardless of its alias when category matches", () => {
    // The exact scenario from the v1.10.2 production incident: user re-bound the
    // shutter order manually so alias defaulted to the device key.
    const bindings = [{ alias: "shutter_state", category: "pool_cover_move" as const }];
    const match = findOrderByCategory(bindings, ["pool_cover_move", "shutter_move"]);
    expect(match?.alias).toBe("shutter_state");
  });

  it("falls back to aliasFallbacks when no category matches", () => {
    const bindings = [
      { alias: "state", category: undefined },
      { alias: "brightness", category: undefined },
    ];
    expect(
      findOrderByCategory(bindings, ["pool_cover_move"], ["state"]),
    ).toEqual(bindings[0]);
  });

  it("falls back to aliasPatterns when no category nor alias matches", () => {
    const bindings = [
      { alias: "shutter2_state", category: undefined },
      { alias: "brightness", category: undefined },
    ];
    expect(
      findOrderByCategory(
        bindings,
        ["pool_cover_move"],
        ["state"],
        [/^shutter\d*_state$/],
      ),
    ).toEqual(bindings[0]);
  });

  it("prefers category over alias when both match", () => {
    const bindings = [
      { alias: "state", category: undefined },
      { alias: "shutter_state", category: "shutter_move" as const },
    ];
    expect(
      findOrderByCategory(bindings, ["shutter_move"], ["state"]),
    ).toEqual(bindings[1]);
  });

  it("returns undefined when nothing matches", () => {
    const bindings = [
      { alias: "brightness", category: "set_brightness" as const },
    ];
    expect(findOrderByCategory(bindings, ["pool_cover_move"], ["state"])).toBeUndefined();
  });

  it("returns undefined for an empty bindings array", () => {
    expect(findOrderByCategory([], ["light_toggle"], ["state"])).toBeUndefined();
  });

  it("does not match a binding whose category is undefined when only category is provided", () => {
    const bindings = [{ alias: "state", category: undefined }];
    expect(findOrderByCategory(bindings, ["light_toggle"])).toBeUndefined();
  });

  it("when multiple bindings match the category list, the first one wins (Array.find order)", () => {
    const bindings = [
      { alias: "first", category: "light_toggle" as const },
      { alias: "second", category: "toggle_power" as const },
      { alias: "third", category: "light_toggle" as const },
    ];
    expect(
      findOrderByCategory(bindings, ["toggle_power", "light_toggle"]),
    ).toEqual(bindings[0]);
  });
});

describe("findDataByCategory", () => {
  it("matches by data category", () => {
    const bindings = [
      { alias: "temperature", category: "temperature" as const },
      { alias: "humidity", category: "humidity" as const },
    ];
    expect(findDataByCategory(bindings, ["humidity"])).toEqual(bindings[1]);
  });

  it("falls back to alias when category is missing", () => {
    const bindings = [
      { alias: "position", category: undefined },
    ];
    expect(
      findDataByCategory(bindings, ["shutter_position"], ["position"]),
    ).toEqual(bindings[0]);
  });

  it("returns the right binding when alias differs from convention but category matches", () => {
    // E.g. a manually re-bound pool_cover position data.
    const bindings = [
      { alias: "shutter_position", category: "shutter_position" as const },
    ];
    const match = findDataByCategory(bindings, ["shutter_position"], ["position"]);
    expect(match?.alias).toBe("shutter_position");
  });
});

describe("weather equipment type relevance", () => {
  it("accepts the Netatmo outdoor module categories (NAModule1)", () => {
    // NAModule1 emits temperature_outdoor + humidity_outdoor; without these
    // entries the outdoor module would be hidden from the weather creation
    // flow and even a manual pick would yield 0 bindings.
    expect(isRelevantData("temperature_outdoor", "weather")).toBe(true);
    expect(isRelevantData("humidity_outdoor", "weather")).toBe(true);
  });

  it("still accepts indoor categories (base + indoor module)", () => {
    expect(isRelevantData("temperature", "weather")).toBe(true);
    expect(isRelevantData("humidity", "weather")).toBe(true);
    expect(isRelevantData("pressure", "weather")).toBe(true);
    expect(isRelevantData("noise", "weather")).toBe(true);
  });

  it("accepts wind, rain and battery", () => {
    expect(isRelevantData("wind", "weather")).toBe(true);
    expect(isRelevantData("rain", "weather")).toBe(true);
    expect(isRelevantData("battery", "weather")).toBe(true);
  });

  it("ignores unrelated categories", () => {
    expect(isRelevantData("light_state", "weather")).toBe(false);
    expect(isRelevantData("shutter_position", "weather")).toBe(false);
  });
});

describe("weather_forecast equipment type relevance", () => {
  it("treats Open-Meteo forecast categories as relevant", () => {
    expect(isRelevantData("weather_condition", "weather_forecast")).toBe(true);
    expect(isRelevantData("temperature_outdoor", "weather_forecast")).toBe(true);
    expect(isRelevantData("rain", "weather_forecast")).toBe(true);
    expect(isRelevantData("wind", "weather_forecast")).toBe(true);
  });

  it("ignores unrelated categories on weather_forecast", () => {
    expect(isRelevantData("light_state", "weather_forecast")).toBe(false);
    expect(isRelevantData("temperature", "weather_forecast")).toBe(false);
  });

  it("declares no relevant orders (Open-Meteo plugin is read-only)", () => {
    expect(isRelevantOrder("state", "weather_forecast")).toBe(false);
  });
});

describe("awning equipment type relevance", () => {
  it("treats awning the same as shutter for relevant data (shutter_position)", () => {
    expect(isRelevantData("shutter_position", "awning")).toBe(true);
    expect(isRelevantData("shutter_position", "shutter")).toBe(true);
    expect(isRelevantData("light_state", "awning")).toBe(false);
  });

  it("treats awning the same as shutter for relevant orders (position/state/target_position)", () => {
    expect(isRelevantOrder("position", "awning")).toBe(true);
    expect(isRelevantOrder("state", "awning")).toBe(true);
    expect(isRelevantOrder("target_position", "awning")).toBe(true);
    expect(isRelevantOrder("color", "awning")).toBe(false);
  });
});

describe("water_valve equipment type relevance", () => {
  // water_valve is key-driven (NOT candidate-based): a Zigbee valve like the
  // SONOFF SWV exposes its open/close as a boolean `light_toggle` `state` order
  // (which the candidate path, enum ON/OFF only, ignores), plus rich telemetry.
  // The legacy RELEVANT_DATA/RELEVANT_ORDERS path must cover the full surface so
  // the valve is proposed AND fully bound (state + flow + battery + irrigation).
  it("accepts the SONOFF SWV data: state (light_state), battery and generic (flow/irrigation/status)", () => {
    expect(isRelevantData("light_state", "water_valve")).toBe(true);
    expect(isRelevantData("battery", "water_valve")).toBe(true);
    // flow, irrigation_*, current_device_status are emitted as category "generic"
    expect(isRelevantData("generic", "water_valve")).toBe(true);
  });

  it("accepts the SONOFF SWV orders: open/close + irrigation params", () => {
    expect(isRelevantOrder("state", "water_valve")).toBe(true);
    expect(isRelevantOrder("irrigation_duration", "water_valve")).toBe(true);
    expect(isRelevantOrder("irrigation_interval", "water_valve")).toBe(true);
    expect(isRelevantOrder("irrigation_capacity", "water_valve")).toBe(true);
    expect(isRelevantOrder("auto_close_when_water_shortage", "water_valve")).toBe(true);
    expect(isRelevantOrder("total_number", "water_valve")).toBe(true);
  });

  it("ignores unrelated categories/orders", () => {
    expect(isRelevantData("shutter_position", "water_valve")).toBe(false);
    expect(isRelevantOrder("color", "water_valve")).toBe(false);
  });
});

describe("gate equipment type relevance (blind single-button RTS gate)", () => {
  // A Somfy RTS gate (via somfyrts2mqtt) is blind: no contact-sensor data, only
  // a `gate_trigger` order. GateControl drives the equipment through the
  // `command` alias, so every path must land on that alias for such a gate.
  it("auto-binds the gate_trigger order (legacy whitelist path)", () => {
    expect(isRelevantOrder("gate_trigger", "gate")).toBe(true);
    // R1..R4 relay gates and an already-standard `command` order still bind.
    expect(isRelevantOrder("command", "gate")).toBe(true);
    expect(isRelevantOrder("R1", "gate")).toBe(true);
  });

  it("manual binding (no category) resolves gate_trigger to the command alias", () => {
    // AddBindingModal calls resolveAlias(key, type) without a category, so the
    // fallback STANDARD_ALIASES must map gate_trigger → command.
    expect(resolveAlias("gate_trigger", "gate")).toBe("command");
    expect(resolveAlias("R1", "gate")).toBe("command");
  });

  it("auto binding (with category) also resolves to the command alias", () => {
    expect(
      resolveAlias("gate_trigger", "gate", { gate_trigger: "command" }, "gate_trigger"),
    ).toBe("command");
  });

  it("ignores unrelated orders", () => {
    expect(isRelevantOrder("position", "gate")).toBe(false);
    expect(isRelevantOrder("color", "gate")).toBe(false);
  });
});

describe("water_heater equipment type (spec 135)", () => {
  it("on/off relay state is relevant, so is optional temperature/power/energy", () => {
    expect(isRelevantData("light_state", "water_heater")).toBe(true);
    expect(isRelevantData("temperature", "water_heater")).toBe(true);
    expect(isRelevantData("power", "water_heater")).toBe(true);
    expect(isRelevantData("energy", "water_heater")).toBe(true);
    expect(isRelevantOrder("state", "water_heater")).toBe(true);
  });

  it("aliases a temperature reading to water_temperature (kept out of zone avg)", () => {
    // The zone aggregator only folds category=temperature bindings with alias
    // exactly "temperature" into the room average — a water heater's water
    // temperature must land on `water_temperature` instead. The per-type rule
    // applies whether or not a category map is passed (manual add path).
    expect(resolveAlias("temperature", "water_heater", undefined, "temperature")).toBe(
      "water_temperature",
    );
    // A different probe key resolves the same, driven by the category.
    expect(resolveAlias("temperature_2", "water_heater", undefined, "temperature")).toBe(
      "water_temperature",
    );
  });

  it("does not touch a temperature on other types", () => {
    expect(resolveAlias("temperature", "sensor", undefined, "temperature")).toBe("temperature");
  });
});

// Spec 133 — camera equipment. Auto-binding is a deliberate SUBSET of what
// the device may expose: snapshot/stream/monitoring auto-bind, light_mode/
// siren/detection are opt-in only (privacy/bandwidth). Order relevance is
// category-driven (isRelevantOrder's 3rd arg), not key-driven, because a
// vendor plugin's raw order key names aren't standardised.
describe("camera equipment type relevance (spec 133 default auto-binding split)", () => {
  it("auto-binds snapshot, stream and monitoring data", () => {
    expect(isRelevantData("camera_snapshot_url", "camera")).toBe(true);
    expect(isRelevantData("camera_stream_url", "camera")).toBe(true);
    expect(isRelevantData("camera_monitoring", "camera")).toBe(true);
  });

  it("does NOT auto-bind light_mode or detection data — opt-in only", () => {
    expect(isRelevantData("camera_light_mode", "camera")).toBe(false);
    expect(isRelevantData("camera_detection", "camera")).toBe(false);
  });

  it("auto-binds the set_camera_monitoring order by category, regardless of the plugin's raw key name", () => {
    expect(isRelevantOrder("any_vendor_key", "camera", "set_camera_monitoring")).toBe(true);
  });

  it("does NOT auto-bind set_camera_light_mode or trigger_camera_siren orders — opt-in only", () => {
    expect(isRelevantOrder("any_vendor_key", "camera", "set_camera_light_mode")).toBe(false);
    expect(isRelevantOrder("any_vendor_key", "camera", "trigger_camera_siren")).toBe(false);
  });

  it("without a category, falls back to the (empty) key whitelist — no accidental auto-bind", () => {
    expect(isRelevantOrder("monitoring", "camera")).toBe(false);
  });
});
