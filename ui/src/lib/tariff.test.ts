import { describe, it, expect } from "vitest";
import { isSummerOn, isTariffSaved, seasonLabel, seasonRange, SUMMER_DEFAULT } from "./tariff";
import type { TariffConfig } from "../types";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

describe("isTariffSaved (issue #384)", () => {
  it("treats the server's empty-schedule response as not saved", () => {
    // GET /api/v1/settings/energy/tariff when `energy.tariff` is absent.
    const empty: TariffConfig = { schedules: [], prices: { hp: 0, hc: 0 } };
    expect(isTariffSaved(empty)).toBe(false);
  });

  it("treats a stored schedule as saved", () => {
    const stored: TariffConfig = {
      schedules: [
        {
          days: [...ALL_DAYS],
          slots: [
            { start: "06:00", end: "22:00", tariff: "hp" },
            { start: "22:00", end: "06:00", tariff: "hc" },
          ],
        },
      ],
      prices: { hp: 0, hc: 0 },
    };
    expect(isTariffSaved(stored)).toBe(true);
  });

  it("considers a saved schedule with zero prices still saved (hours are set, prices are a separate concern)", () => {
    const hoursOnly: TariffConfig = {
      schedules: [{ days: [...ALL_DAYS], slots: [{ start: "00:00", end: "00:00", tariff: "hc" }] }],
      prices: { hp: 0, hc: 0 },
    };
    expect(isTariffSaved(hoursOnly)).toBe(true);
  });
});

describe("seasons (spec 204)", () => {
  it("reads summer inclusive at both ends", () => {
    expect(isSummerOn(SUMMER_DEFAULT, new Date(2027, 2, 31, 23, 59))).toBe(false);
    expect(isSummerOn(SUMMER_DEFAULT, new Date(2027, 3, 1, 0, 0))).toBe(true);
    expect(isSummerOn(SUMMER_DEFAULT, new Date(2026, 9, 31, 23, 59))).toBe(true);
    expect(isSummerOn(SUMMER_DEFAULT, new Date(2026, 10, 1, 0, 0))).toBe(false);
  });

  it("reads a custom season inclusive at both ends", () => {
    const custom = { from: "05-15", to: "09-15" };
    expect(isSummerOn(custom, new Date(2026, 4, 14))).toBe(false);
    expect(isSummerOn(custom, new Date(2026, 4, 15))).toBe(true);
    expect(isSummerOn(custom, new Date(2026, 8, 15))).toBe(true);
    expect(isSummerOn(custom, new Date(2026, 8, 16))).toBe(false);
  });

  it("derives winter as the rest of the year", () => {
    expect(seasonRange(SUMMER_DEFAULT, "winter")).toEqual({ from: "11-01", to: "03-31" });
    const march = { from: "03-01", to: "09-15" };
    // Seen in November 2026, the winter ends in February 2027 (not a leap year).
    expect(seasonRange(march, "winter", new Date(2026, 10, 15))).toEqual({
      from: "09-16",
      to: "02-28",
    });
    // Seen in January 2028, the winter in force ends in February 2028 (a leap year).
    expect(seasonRange(march, "winter", new Date(2028, 0, 15))).toEqual({
      from: "09-16",
      to: "02-29",
    });
    // Seen in November 2027, the next winter ends in February 2028.
    expect(seasonRange(march, "winter", new Date(2027, 10, 15)).to).toBe("02-29");
  });

  it("labels each season from the stored dates, in French and English", () => {
    expect(seasonLabel(SUMMER_DEFAULT, "winter", "fr")).toEqual({
      from: "1er novembre",
      to: "31 mars",
    });
    expect(seasonLabel(SUMMER_DEFAULT, "summer", "fr")).toEqual({
      from: "1er avril",
      to: "31 octobre",
    });
    expect(seasonLabel(SUMMER_DEFAULT, "summer", "en")).toEqual({
      from: "April 1",
      to: "October 31",
    });
    expect(seasonLabel({ from: "05-15", to: "09-15" }, "winter", "en")).toEqual({
      from: "September 16",
      to: "May 14",
    });
  });
});
