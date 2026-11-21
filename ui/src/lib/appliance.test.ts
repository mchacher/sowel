import { describe, it, expect } from "vitest";
import type { DataBindingWithValue } from "../types";
import { applianceIsOn, applianceState, applianceStateLabelKey } from "./appliance";

function bindings(values: Record<string, unknown>): DataBindingWithValue[] {
  return Object.entries(values).map(
    ([alias, value]) => ({ alias, value }) as unknown as DataBindingWithValue,
  );
}

describe("applianceIsOn (spec 213)", () => {
  it("follows a known state", () => {
    expect(applianceIsOn(bindings({ state: "running", power: 0 }))).toBe(true);
    expect(applianceIsOn(bindings({ state: "off", power: 6 }))).toBe(false);
  });

  it("is on mid-cycle with plug watts and a reported state", () => {
    expect(applianceIsOn(bindings({ state: "running", power: 1900 }))).toBe(true);
  });

  it("falls back to a boolean power without a state", () => {
    expect(applianceIsOn(bindings({ power: true }))).toBe(true);
    expect(applianceIsOn(bindings({ power: false }))).toBe(false);
  });

  it("falls back to watts without a state", () => {
    expect(applianceIsOn(bindings({ power: 6.5 }))).toBe(true);
    expect(applianceIsOn(bindings({ power: 0.4 }))).toBe(false);
  });

  it("reads a null derived state as no state", () => {
    expect(applianceState(bindings({ state: null, power: 6.5 }))).toBeNull();
    expect(applianceIsOn(bindings({ state: null, power: 6.5 }))).toBe(true);
    expect(applianceIsOn(bindings({}))).toBe(false);
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
