import { describe, it, expect } from "vitest";
import { isOrderOutcomeTracked } from "./order-outcome-tracking.js";

describe("isOrderOutcomeTracked (spec 188 O10)", () => {
  it("follows a gate and a door by default", () => {
    expect(isOrderOutcomeTracked({ type: "gate" })).toBe(true);
    expect(isOrderOutcomeTracked({ type: "door", trackOrderOutcome: null })).toBe(true);
  });

  it("leaves a shutter and an awning alone by default", () => {
    expect(isOrderOutcomeTracked({ type: "shutter" })).toBe(false);
    expect(isOrderOutcomeTracked({ type: "awning", trackOrderOutcome: null })).toBe(false);
  });

  it("follows the admin's explicit choice", () => {
    expect(isOrderOutcomeTracked({ type: "shutter", trackOrderOutcome: true })).toBe(true);
    expect(isOrderOutcomeTracked({ type: "gate", trackOrderOutcome: false })).toBe(false);
  });

  it("never follows a type it cannot prove, whatever the switch says", () => {
    expect(isOrderOutcomeTracked({ type: "light_onoff", trackOrderOutcome: true })).toBe(false);
  });
});
