import { describe, it, expect } from "vitest";
import { isTariffSaved } from "./tariff";
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
