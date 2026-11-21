import { describe, it, expect } from "vitest";
import type { DataBindingWithValue } from "../types";
import { applianceIsOn, applianceState, applianceStateLabelKey } from "./appliance";

function bindings(values: Record<string, unknown>): DataBindingWithValue[] {
  return Object.entries(values).map(
    ([alias, value]) => ({ alias, value }) as unknown as DataBindingWithValue,
  );
}

describe("applianceIsOn (spec 214)", () => {
  it("is on mid-cycle with plug watts, whatever the state says", () => {
    expect(applianceIsOn(bindings({ state: "running", power: 1900 }))).toBe(true);
    expect(applianceIsOn(bindings({ state: "finished", power: 5 }))).toBe(true);
  });

  it("is off when the plug reads 0 W, even on a resting SmartThings state", () => {
    expect(applianceIsOn(bindings({ state: "ready", power: 0 }))).toBe(false);
  });

  it("follows a boolean power first (a SmartThings washer switched off keeps `ready`)", () => {
    expect(applianceIsOn(bindings({ power: false, state: "ready" }))).toBe(false);
    expect(applianceIsOn(bindings({ power: true, state: "ready" }))).toBe(true);
  });

  it("falls back to the state without a power", () => {
    expect(applianceIsOn(bindings({ state: "running" }))).toBe(true);
    expect(applianceIsOn(bindings({ state: "off" }))).toBe(false);
    expect(applianceIsOn(bindings({ state: null }))).toBe(false);
    expect(applianceIsOn(bindings({}))).toBe(false);
  });

  it("reads a null state as no state", () => {
    expect(applianceState(bindings({ state: null, power: 6.5 }))).toBeNull();
  });
});

describe("applianceStateLabelKey", () => {
  it("labels the derived values, leaves unknown ones raw", () => {
    expect(applianceStateLabelKey("finished")).toBe("appliance.state.finished");
    expect(applianceStateLabelKey("ready")).toBe("appliance.state.ready");
    expect(applianceStateLabelKey("running")).toBe("common.running");
    expect(applianceStateLabelKey("delayWash")).toBeNull();
  });
});
