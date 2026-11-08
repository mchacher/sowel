import { describe, it, expect } from "vitest";
import type { EnergyTotals, PvForecastResponse } from "../../types";
import { localDateStr } from "../../lib/local-date";
import {
  consumptionHeadline,
  periodContextLabel,
  productionYTicks,
  todayForecast,
} from "./period-headline";

// Spec 197 (FR-E6.1–2) — the figures the Consumption and Production cards open on.

function totals(over: Partial<EnergyTotals> = {}): EnergyTotals {
  return {
    total_consumption: 9050,
    total_hp: 7080,
    total_hc: 1970,
    total_production: 60,
    total_autoconso: 60,
    total_injection: 0,
    cost_hp: 1.47,
    cost_hc: 0.31,
    cost_total: 1.78,
    ...over,
  };
}

describe("consumptionHeadline", () => {
  it("in Wh, totals the grid and the sun, split by tariff", () => {
    const h = consumptionHeadline(totals(), "wh", true);
    expect(h.total).toBe(9110);
    expect(h.peak).toBe(7080);
    expect(h.offPeak).toBe(1970);
    expect(h.selfPct).toBeCloseTo((60 / 9110) * 100);
  });

  it("in €, the total is the bill: self-consumption stays out of it", () => {
    const h = consumptionHeadline(totals(), "eur", true);
    expect(h.total).toBe(1.78);
    expect(h.peak).toBe(1.47);
    expect(h.offPeak).toBe(0.31);
    // The share is a share of energy in both views.
    expect(h.selfPct).toBeCloseTo((60 / 9110) * 100);
  });

  it("drops the tariff split without HP/HC, and the share without the sun", () => {
    const h = consumptionHeadline(
      totals({ total_hp: 9050, total_hc: 0, total_autoconso: 0 }),
      "wh",
      true,
    );
    expect(h.peak).toBeNull();
    expect(h.offPeak).toBeNull();
    expect(h.selfPct).toBeNull();

    expect(consumptionHeadline(totals(), "wh", false).selfPct).toBeNull();
  });
});

function forecast(curve: { at: string; watts: number }[], active = true): PvForecastResponse {
  return { active, curve } as unknown as PvForecastResponse;
}

/** A local hour of the given day, as the ISO instant the API sends. */
function at(day: Date, hour: number): string {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe("todayForecast", () => {
  const now = new Date(2026, 10, 8, 9, 30);
  const tomorrow = new Date(2026, 10, 9, 12);

  it("sums today's hours and keeps the largest one", () => {
    const f = todayForecast(
      [
        forecast([
          { at: at(now, 10), watts: 1200 },
          { at: at(now, 13), watts: 2400 },
          { at: at(tomorrow, 13), watts: 9000 },
        ]),
      ],
      now,
    );
    expect(f).toEqual({ totalKwh: 3.6, peakHourKwh: 2.4 });
  });

  it("adds the arrays hour by hour before taking the peak", () => {
    const f = todayForecast(
      [
        forecast([
          { at: at(now, 12), watts: 1000 },
          { at: at(now, 13), watts: 1500 },
        ]),
        forecast([
          { at: at(now, 12), watts: 1000 },
          { at: at(now, 13), watts: 200 },
        ]),
      ],
      now,
    );
    expect(f?.peakHourKwh).toBeCloseTo(2);
    expect(f?.totalKwh).toBeCloseTo(3.7);
  });

  it("is null without a curve for today or without an active array", () => {
    expect(todayForecast([], now)).toBeNull();
    expect(todayForecast([forecast([{ at: at(tomorrow, 12), watts: 900 }])], now)).toBeNull();
    expect(todayForecast([forecast([{ at: at(now, 12), watts: 900 }], false)], now)).toBeNull();
  });
});

describe("productionYTicks", () => {
  it("keeps the 0.5 kWh frame of a day without a forecast", () => {
    expect(productionYTicks(0.05, "day")).toEqual([0, 0.5]);
  });

  it("raises the day view's top to the forecast peak hour", () => {
    expect(productionYTicks(0.05, "day", 2.3)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });

  it("keeps the real maximum when it beats the forecast", () => {
    expect(productionYTicks(3.1, "day", 2.3).at(-1)).toBe(3.5);
  });

  it("ignores the floor on the other periods", () => {
    expect(productionYTicks(12, "week", 40)).toEqual([0, 5, 10, 15]);
  });
});

describe("periodContextLabel", () => {
  const t = (key: string) => key;

  it("names the running period", () => {
    expect(periodContextLabel("day", localDateStr(), "fr-FR", t)).toBe(
      "energy.headline.current.day",
    );
  });

  it("names a past period by its date, where « aujourd'hui » would be false", () => {
    expect(periodContextLabel("day", "2026-03-09", "fr-FR", t)).toBe("9 mars 2026");
  });
});
