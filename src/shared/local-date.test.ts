import { describe, it, expect } from "vitest";
import { localDateStr } from "./local-date";

describe("localDateStr", () => {
  it("formats the LOCAL calendar date (zero-padded), not UTC", () => {
    // Built from local components → timezone-stable regardless of the test env TZ.
    expect(localDateStr(new Date(2026, 7, 12, 0, 48))).toBe("2026-08-12"); // month 0-based (7 = Aug)
    expect(localDateStr(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05"); // padding + month+1
    expect(localDateStr(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});
