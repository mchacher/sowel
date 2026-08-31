import { describe, it, expect } from "vitest";
import { formatRelative } from "./format-relative";

// Issue #839 — the helper's day suffix was the French `j` in every copy, kept
// verbatim while the output stood on its own. This is the change that puts it
// inside a translated sentence ("{{age}} ago"), where an English tile read
// "124 j ago" for the #744 wood-stove case.

function agoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

const en = (key: string, opts?: Record<string, unknown>) =>
  ({
    "reading.age.seconds": `${opts?.count}s`,
    "reading.age.minutes": `${opts?.count} min`,
    "reading.age.hours": `${opts?.count} h`,
    "reading.age.days": `${opts?.count}d`,
  })[key] ?? key;

describe("formatRelative", () => {
  it("keeps its original output byte-for-byte when called without a localizer", () => {
    expect(formatRelative(agoIso(30))).toBe("30s");
    expect(formatRelative(agoIso(16 * 60))).toBe("16 min");
    expect(formatRelative(agoIso(3 * 3600))).toBe("3 h");
    expect(formatRelative(agoIso(124 * 24 * 3600))).toBe("124 j");
  });

  it("localises the day suffix so an English sentence does not read '124 j ago'", () => {
    expect(formatRelative(agoIso(124 * 24 * 3600), en)).toBe("124d");
    expect(formatRelative(agoIso(16 * 60), en)).toBe("16 min");
  });

  it("returns an empty string for a missing timestamp", () => {
    expect(formatRelative(null)).toBe("");
    expect(formatRelative(null, en)).toBe("");
  });
});
