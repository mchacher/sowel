import { describe, it, expect } from "vitest";
import { xTickInterval, MIN_LABEL_GAP_PX, ENERGY_CHART_Y_AXIS_PX } from "./chart-ticks";

// Plot width of the energy cards for a given viewport: page gutters and card
// padding (16 px each side on a phone), the desktop sidebar (260 px), then the Y axis.
function plotWidthAt(viewport: number): number {
  if (viewport < 640) return viewport - 2 * 16 - 2 * 16 - ENERGY_CHART_Y_AXIS_PX;
  return viewport - 260 - 2 * 24 - 2 * 20 - ENERGY_CHART_Y_AXIS_PX;
}

/** Hours between two labels, for 24 hourly bars. */
const labelEvery = (interval: number) => interval + 1;

describe("xTickInterval — day", () => {
  it("labels every 6 h on a 390 px phone", () => {
    expect(labelEvery(xTickInterval("day", 24, plotWidthAt(390)))).toBe(6);
  });

  it("labels every 6 h on a 360 px phone too", () => {
    expect(labelEvery(xTickInterval("day", 24, plotWidthAt(360)))).toBe(6);
  });

  it("labels every 2 h on a 1440 px desktop", () => {
    expect(labelEvery(xTickInterval("day", 24, plotWidthAt(1440)))).toBe(2);
  });

  it("never labels every hour, even very wide", () => {
    expect(labelEvery(xTickInterval("day", 24, 4000))).toBe(2);
  });

  it("keeps the desktop look until the chart is measured", () => {
    expect(labelEvery(xTickInterval("day", 24, 0))).toBe(2);
    expect(labelEvery(xTickInterval("day", 24, -80))).toBe(2);
  });
});

describe("xTickInterval — month and year on a phone", () => {
  const phones = [360, 390, 430];

  it.each(phones)("month labels stay at least the minimum gap apart at %i px", (vp) => {
    for (const days of [28, 29, 30, 31]) {
      const step = xTickInterval("month", days, plotWidthAt(vp)) + 1;
      expect(step * (plotWidthAt(vp) / days)).toBeGreaterThanOrEqual(MIN_LABEL_GAP_PX.month);
    }
  });

  it.each(phones)("year labels stay at least the minimum gap apart at %i px", (vp) => {
    const step = xTickInterval("year", 12, plotWidthAt(vp)) + 1;
    expect(step * (plotWidthAt(vp) / 12)).toBeGreaterThanOrEqual(MIN_LABEL_GAP_PX.year);
  });

  it("month on a 390 px phone shows the 1st, 8th, 15th, 22nd and 29th", () => {
    expect(xTickInterval("month", 31, plotWidthAt(390))).toBe(6);
  });

  it("year on a 390 px phone shows every other month", () => {
    expect(xTickInterval("year", 12, plotWidthAt(390))).toBe(1);
  });
});

describe("xTickInterval — wide screens and week", () => {
  it("shows every day of the month and every month on desktop", () => {
    expect(xTickInterval("month", 31, plotWidthAt(1440))).toBe(0);
    expect(xTickInterval("year", 12, plotWidthAt(1440))).toBe(0);
  });

  it("always shows the seven weekdays", () => {
    expect(xTickInterval("week", 7, plotWidthAt(360))).toBe(0);
    expect(xTickInterval("week", 7, plotWidthAt(1440))).toBe(0);
  });

  it("treats an unknown period like a day", () => {
    expect(xTickInterval("custom", 24, plotWidthAt(390))).toBe(5);
  });
});
