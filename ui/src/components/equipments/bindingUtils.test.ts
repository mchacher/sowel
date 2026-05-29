import { describe, it, expect } from "vitest";
import { isRelevantData, isRelevantOrder } from "./bindingUtils";
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
