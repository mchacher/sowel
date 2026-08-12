import { describe, it, expect, vi, afterEach } from "vitest";
import { localDateStr } from "./local-date";
import { canGoForward } from "../store/useEnergy";

describe("localDateStr", () => {
  it("formats the LOCAL calendar date (zero-padded), not UTC", () => {
    // Built from local components, so these are timezone-stable in any test env.
    expect(localDateStr(new Date(2026, 7, 12, 0, 48))).toBe("2026-08-12"); // month is 0-based (7 = Aug)
    expect(localDateStr(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05"); // padding + month+1
    expect(localDateStr(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});

describe("canGoForward — local-midnight boundary", () => {
  afterEach(() => vi.useRealTimers());

  it("lets you reach today right after LOCAL midnight (was blocked when today was computed in UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 0, 48)); // 00:48 local on Aug 12
    expect(canGoForward("2026-08-11", "day")).toBe(true); // yesterday → can advance to today
    expect(canGoForward("2026-08-12", "day")).toBe(false); // today → cannot go into the future
  });
});
