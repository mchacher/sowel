import { describe, it, expect } from "vitest";
import { formatHourLabel, formatHourRange } from "./hour-label";

// Issue #730 — these were template literals, invisible to a "fr-FR" grep, and
// just as French on an English page.

describe("hour labels", () => {
  it("uses French hour notation in French", () => {
    expect(formatHourLabel(8, "fr-FR")).toBe("08h");
    expect(formatHourRange(8, "fr-FR")).toBe("08h00 - 09h00");
  });

  it("uses a colon in English, and never a 12-hour clock", () => {
    expect(formatHourLabel(14, "en-US")).toBe("14:00");
    expect(formatHourRange(14, "en-US")).toBe("14:00 - 15:00");
  });

  it("wraps the last hour of the day back to midnight", () => {
    expect(formatHourRange(23, "fr-FR")).toBe("23h00 - 00h00");
    expect(formatHourRange(23, "en-US")).toBe("23:00 - 00:00");
  });

  it("pads single-digit hours so the axis ticks stay the same width", () => {
    expect(formatHourLabel(0, "en-US")).toBe("00:00");
    expect(formatHourLabel(9, "fr-FR")).toBe("09h");
  });
});
