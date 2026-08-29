import { describe, it, expect } from "vitest";
import { formatDateLabel } from "./period-label";

// Issue #730 — the energy copy of this pinned every call to "fr-FR", so the
// date between the navigator arrows stayed French whatever the UI language.

describe("formatDateLabel", () => {
  it("formats a day in the locale it is given", () => {
    expect(formatDateLabel("2026-03-09", "day", "fr-FR")).toBe("9 mars 2026");
    expect(formatDateLabel("2026-03-09", "day", "en-US")).toBe("March 9, 2026");
  });

  it("formats a month in the locale it is given", () => {
    expect(formatDateLabel("2026-03-09", "month", "fr-FR")).toBe("mars 2026");
    expect(formatDateLabel("2026-03-09", "month", "en-US")).toBe("March 2026");
  });

  it("spans a week from its Monday to its Sunday", () => {
    // 2026-03-11 is a Wednesday: the label must still start on the 9th.
    const fr = formatDateLabel("2026-03-11", "week", "fr-FR");
    expect(fr).toBe("9 mars - 15 mars 2026");
    const en = formatDateLabel("2026-03-11", "week", "en-US");
    expect(en).toBe("Mar 9 - Mar 15, 2026");
  });

  it("treats Sunday as the last day of its week, not the first", () => {
    // getDay() === 0 is the edge the -6 offset exists for.
    expect(formatDateLabel("2026-03-15", "week", "fr-FR")).toBe("9 mars - 15 mars 2026");
  });

  it("renders a year as digits, identical in every locale", () => {
    expect(formatDateLabel("2026-03-09", "year", "fr-FR")).toBe("2026");
    expect(formatDateLabel("2026-03-09", "year", "en-US")).toBe("2026");
  });

  it("reads the date at noon, so no timezone can shift it a day", () => {
    // Parsing "2026-03-09" as UTC midnight would render the 8th west of UTC.
    expect(formatDateLabel("2026-03-09", "day", "en-US")).toContain("9");
  });
});
