import { describe, expect, it } from "vitest";
import { needsDetailSheet } from "./widget-utils";

describe("needsDetailSheet", () => {
  it("opens the sheet for an EV charger instead of toggling on a tap (spec 182)", () => {
    expect(needsDetailSheet("ev_charger")).toBe(true);
  });

  it("opens the sheet for an electric vehicle (spec 183)", () => {
    expect(needsDetailSheet("electric_vehicle")).toBe(true);
  });

  it("keeps a plain light a direct toggle", () => {
    expect(needsDetailSheet("light_onoff")).toBe(false);
  });
});
