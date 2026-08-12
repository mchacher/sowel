import { describe, it, expect } from "vitest";
import { localDateStr } from "./local-date";

// NOTE: kept dependency-free on purpose. The root vitest config also runs UI
// logic tests in a node env (see include in vitest.config.ts), so a test picked
// up there must not import the zustand store. canGoForward's local-midnight
// behavior is exercised through this helper (which it uses) plus the store's
// own usage; here we lock the helper's formatting.
describe("localDateStr", () => {
  it("formats the LOCAL calendar date (zero-padded), not UTC", () => {
    // Built from local components → timezone-stable in any test env.
    expect(localDateStr(new Date(2026, 7, 12, 0, 48))).toBe("2026-08-12"); // month 0-based (7 = Aug)
    expect(localDateStr(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05"); // padding + month+1
    expect(localDateStr(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});
