import { describe, it, expect } from "vitest";
import { MOBILE_FAB_BOTTOM } from "./mobile-fab";

/**
 * Regression guard for issue #496: the mobile dashboard edit FAB overlapped the
 * bottom nav "Plus"/Settings button on devices with a bottom safe-area inset
 * because its offset was a hardcoded pixel value. The offset must stay
 * safe-area aware so the clearance above the nav is constant on every device.
 */
describe("MOBILE_FAB_BOTTOM (#496)", () => {
  it("is the exact safe-area-aware offset (spaces around + keep the calc valid CSS)", () => {
    expect(MOBILE_FAB_BOTTOM).toBe("calc(72px + env(safe-area-inset-bottom, 0px))");
  });

  it("is a calc() expression", () => {
    expect(MOBILE_FAB_BOTTOM).toMatch(/^calc\(.*\)$/);
  });

  it("accounts for the bottom safe-area inset", () => {
    expect(MOBILE_FAB_BOTTOM).toContain("env(safe-area-inset-bottom");
  });

  it("keeps the base 72px clearance above the nav", () => {
    expect(MOBILE_FAB_BOTTOM).toContain("72px");
  });

  it("is not a bare hardcoded pixel offset", () => {
    expect(MOBILE_FAB_BOTTOM).not.toMatch(/^\d+px$/);
  });
});
