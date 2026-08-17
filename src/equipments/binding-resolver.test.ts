import { describe, it, expect } from "vitest";
import { findDataByCategory, findOrderByCategory } from "./binding-resolver.js";

describe("findOrderByCategory", () => {
  it("matches the first binding by category", () => {
    const bindings = [
      { alias: "state", category: "light_toggle" as const },
      { alias: "brightness", category: "set_brightness" as const },
    ];
    expect(findOrderByCategory(bindings, ["light_toggle"])).toEqual(bindings[0]);
  });

  it("matches any of several categories", () => {
    const bindings = [{ alias: "shutter_state", category: "pool_cover_move" as const }];
    expect(findOrderByCategory(bindings, ["pool_cover_move", "shutter_move"])).toEqual(bindings[0]);
  });

  it("falls back to aliasFallbacks when no category matches", () => {
    const bindings = [
      { alias: "state", category: undefined },
      { alias: "brightness", category: undefined },
    ];
    expect(findOrderByCategory(bindings, ["light_toggle"], ["state"])).toEqual(bindings[0]);
  });

  it("falls back to aliasPatterns when no category nor alias matches", () => {
    const bindings = [{ alias: "shutter2_state", category: undefined }];
    expect(
      findOrderByCategory(bindings, ["shutter_move"], ["state"], [/^shutter\d*_state$/]),
    ).toEqual(bindings[0]);
  });

  it("prefers category over alias when both match", () => {
    const bindings = [
      { alias: "state", category: undefined },
      { alias: "shutter_state", category: "shutter_move" as const },
    ];
    expect(findOrderByCategory(bindings, ["shutter_move"], ["state"])).toEqual(bindings[1]);
  });

  it("returns undefined when nothing matches", () => {
    const bindings = [{ alias: "brightness", category: "set_brightness" as const }];
    expect(findOrderByCategory(bindings, ["light_toggle"], ["state"])).toBeUndefined();
  });

  it("returns undefined for an empty bindings array", () => {
    expect(findOrderByCategory([], ["light_toggle"], ["state"])).toBeUndefined();
  });

  it("when multiple bindings match the category list, the first one wins (Array.find order)", () => {
    const bindings = [
      { alias: "first", category: "light_toggle" as const },
      { alias: "second", category: "toggle_power" as const },
      { alias: "third", category: "light_toggle" as const },
    ];
    // Both `first` and `third` carry light_toggle; `second` carries toggle_power.
    // The resolver scans bindings in array order regardless of the categories
    // argument order, so `first` wins.
    expect(findOrderByCategory(bindings, ["toggle_power", "light_toggle"])).toEqual(bindings[0]);
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
    const bindings = [{ alias: "state", category: undefined }];
    expect(findDataByCategory(bindings, ["light_state"], ["state"])).toEqual(bindings[0]);
  });

  it("prefers category over alias when both match (spec 110 invariant)", () => {
    // A light_onoff bound through z2m: alias="state" and category="light_state".
    // Both filters match; we must consistently pick the category-resolved one.
    const bindings = [{ alias: "state", category: "light_state" as const }];
    expect(findDataByCategory(bindings, ["light_state"], ["state"])).toEqual(bindings[0]);
  });
});

describe("solar channel resolution (spec 152)", () => {
  it("resolves the solar command independently of the main on/off", () => {
    const bindings = [
      { alias: "state", category: "light_toggle" as const },
      { alias: "solar", category: "solar_toggle" as const },
    ];
    expect(findOrderByCategory(bindings, ["solar_toggle"], ["solar"])).toEqual(bindings[1]);
    // The main resolver never picks the solar binding.
    expect(findOrderByCategory(bindings, ["light_toggle", "toggle_power"], ["state"])).toEqual(
      bindings[0],
    );
  });

  it("resolves solar on a solar-only equipment (no main on/off, e.g. Calypso)", () => {
    const bindings = [{ alias: "solar", category: "solar_toggle" as const }];
    expect(findOrderByCategory(bindings, ["solar_toggle"], ["solar"])).toEqual(bindings[0]);
    // No main channel to resolve.
    expect(
      findOrderByCategory(bindings, ["light_toggle", "toggle_power"], ["state"]),
    ).toBeUndefined();
  });

  it("resolves solar_state data distinctly from the main light_state", () => {
    const bindings = [
      { alias: "state", category: "light_state" as const },
      { alias: "solar_state", category: "solar_state" as const },
    ];
    expect(findDataByCategory(bindings, ["solar_state"], ["solar_state"])).toEqual(bindings[1]);
    expect(findDataByCategory(bindings, ["light_state"], ["state"])).toEqual(bindings[0]);
  });
});
