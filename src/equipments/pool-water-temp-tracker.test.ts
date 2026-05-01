import { describe, it, expect } from "vitest";
import {
  decideActive,
  evaluateEffectiveWaterTemperature,
  pickAlias,
  pickAliasNumber,
} from "./pool-water-temp-tracker.js";

const HOUR_MS = 60 * 60 * 1000;

describe("decideActive", () => {
  it("uses filtration when bound (string ON)", () => {
    expect(decideActive("ON", "OFF")).toBe(true);
  });
  it("uses filtration when bound (string OFF)", () => {
    expect(decideActive("OFF", "SMART")).toBe(false);
  });
  it("uses filtration when bound (boolean)", () => {
    expect(decideActive(true, "OFF")).toBe(true);
    expect(decideActive(false, "SMART")).toBe(false);
  });
  it("falls back to mode when filtration not bound", () => {
    expect(decideActive(undefined, "SMART")).toBe(true);
    expect(decideActive(undefined, "OFF")).toBe(false);
  });
  it("returns true when neither signal bound", () => {
    expect(decideActive(undefined, undefined)).toBe(true);
  });
});

describe("pickAlias / pickAliasNumber", () => {
  const bindings = [
    { alias: "temperature", value: 22.0 },
    { alias: "mode", value: "SMART" },
    { alias: "setpoint", value: "25.5" },
    { alias: "filtration_state", value: true },
  ];
  it("finds alias by name", () => {
    expect(pickAlias(bindings, "mode")).toBe("SMART");
    expect(pickAlias(bindings, "missing")).toBeUndefined();
  });
  it("returns numeric only when value is number-like", () => {
    expect(pickAliasNumber(bindings, "temperature")).toBe(22.0);
    expect(pickAliasNumber(bindings, "setpoint")).toBe(25.5);
    expect(pickAliasNumber(bindings, "mode")).toBeNull();
    expect(pickAliasNumber(bindings, "missing")).toBeNull();
  });
});

describe("evaluateEffectiveWaterTemperature", () => {
  const baseNow = new Date("2026-05-01T12:00:00Z").getTime();

  it("filtration bound + ON → live water, cache updated", () => {
    const r = evaluateEffectiveWaterTemperature({
      water: 22.0,
      filtration: "ON",
      mode: "OFF",
      prior: { lastActiveValue: null, lastActiveTs: null },
      now: baseNow,
    });
    expect(r.effective).toBe(22.0);
    expect(r.next.lastActiveValue).toBe(22.0);
    expect(r.next.lastActiveTs).toBe(baseNow);
  });

  it("filtration bound + OFF, last active 1h ago → frozen", () => {
    const prior = { lastActiveValue: 21.5, lastActiveTs: baseNow - 1 * HOUR_MS };
    const r = evaluateEffectiveWaterTemperature({
      water: 18.0,
      filtration: "OFF",
      mode: "OFF",
      prior,
      now: baseNow,
    });
    expect(r.effective).toBe(21.5);
    expect(r.next).toBe(prior);
  });

  it("filtration bound + OFF, last active 25h ago → null", () => {
    const prior = { lastActiveValue: 21.5, lastActiveTs: baseNow - 25 * HOUR_MS };
    const r = evaluateEffectiveWaterTemperature({
      water: 18.0,
      filtration: "OFF",
      mode: "OFF",
      prior,
      now: baseNow,
    });
    expect(r.effective).toBeNull();
    expect(r.next).toBe(prior);
  });

  it("filtration not bound, mode=SMART → live water, cache updated", () => {
    const r = evaluateEffectiveWaterTemperature({
      water: 22.0,
      filtration: undefined,
      mode: "SMART",
      prior: { lastActiveValue: null, lastActiveTs: null },
      now: baseNow,
    });
    expect(r.effective).toBe(22.0);
    expect(r.next.lastActiveTs).toBe(baseNow);
  });

  it("filtration not bound, mode=OFF, last active 1h ago → frozen", () => {
    const prior = { lastActiveValue: 21.5, lastActiveTs: baseNow - 1 * HOUR_MS };
    const r = evaluateEffectiveWaterTemperature({
      water: 18.0,
      filtration: undefined,
      mode: "OFF",
      prior,
      now: baseNow,
    });
    expect(r.effective).toBe(21.5);
  });

  it("filtration not bound, mode=OFF, last active 25h ago → null", () => {
    const prior = { lastActiveValue: 21.5, lastActiveTs: baseNow - 25 * HOUR_MS };
    const r = evaluateEffectiveWaterTemperature({
      water: 18.0,
      filtration: undefined,
      mode: "OFF",
      prior,
      now: baseNow,
    });
    expect(r.effective).toBeNull();
  });

  it("active but water is null → keeps prior cache and returns prior value (within window)", () => {
    const prior = { lastActiveValue: 21.5, lastActiveTs: baseNow - 1 * HOUR_MS };
    const r = evaluateEffectiveWaterTemperature({
      water: null,
      filtration: "ON",
      mode: "SMART",
      prior,
      now: baseNow,
    });
    // active+null is treated as "no fresh sample, keep cache"
    expect(r.effective).toBe(21.5);
    expect(r.next).toBe(prior);
  });
});
