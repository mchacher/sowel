import { describe, it, expect } from "vitest";
import { fitYAxis } from "./y-axis";

describe("fitYAxis", () => {
  it("pads the data range on both sides so the curve never touches the frame", () => {
    // Tank temperature: 7 °C of span, 8 % margin = 0.56 on each side.
    const fitted = fitYAxis([48, 51.2, 55, 49.4])!;
    expect(fitted.domain[0]).toBeCloseTo(47.44, 5);
    expect(fitted.domain[1]).toBeCloseTo(55.56, 5);
    expect(fitted.domain[0]).toBeLessThan(48);
    expect(fitted.domain[1]).toBeGreaterThan(55);
  });

  it("keeps every tick inside the domain", () => {
    const fitted = fitYAxis([48, 55])!;
    expect(fitted.ticks[0]).toBeGreaterThanOrEqual(fitted.domain[0]);
    expect(fitted.ticks[fitted.ticks.length - 1]).toBeLessThanOrEqual(fitted.domain[1]);
  });

  it("spaces the ticks evenly on a round step, free of float noise", () => {
    const fitted = fitYAxis([48, 55])!;
    expect(fitted.ticks.length).toBeGreaterThanOrEqual(2);
    const step = fitted.ticks[1] - fitted.ticks[0];
    for (let i = 1; i < fitted.ticks.length; i++) {
      expect(fitted.ticks[i] - fitted.ticks[i - 1]).toBeCloseTo(step, 9);
      // 0.30000000000000004 would render as an unreadable label.
      expect(String(fitted.ticks[i]).length).toBeLessThanOrEqual(8);
    }
  });

  it("clamps the lower bound at zero for a series that never goes negative", () => {
    // A 0…3000 W power curve must keep its zero baseline.
    expect(fitYAxis([0, 1200, 3000])!.domain[0]).toBe(0);
    // Even when the min is above zero but the padding would dip below it.
    expect(fitYAxis([2, 100])!.domain[0]).toBe(0);
  });

  it("lets the lower bound go negative when the data does", () => {
    const fitted = fitYAxis([-5, 12])!;
    expect(fitted.domain[0]).toBeLessThan(-5);
  });

  it("opens a symmetric window around a flat non-zero series", () => {
    const fitted = fitYAxis([20.5, 20.5, 20.5])!;
    expect(fitted.domain[0]).toBeLessThan(20.5);
    expect(fitted.domain[1]).toBeGreaterThan(20.5);
    expect(20.5 - fitted.domain[0]).toBeCloseTo(fitted.domain[1] - 20.5, 9);
    expect(fitted.ticks.length).toBeGreaterThanOrEqual(2);
  });

  it("gives a flat zero series a [0, 1] window", () => {
    expect(fitYAxis([0, 0])!.domain).toEqual([0, 1]);
  });

  it("returns null when there is nothing to fit", () => {
    expect(fitYAxis([])).toBeNull();
    expect(fitYAxis([NaN, Infinity, -Infinity])).toBeNull();
  });

  it("ignores non-finite values mixed into real data", () => {
    expect(fitYAxis([NaN, 48, Infinity, 55])).toEqual(fitYAxis([48, 55]));
  });

  it("scales the padding with the margin ratio", () => {
    const tight = fitYAxis([48, 55], 0.02)!;
    const loose = fitYAxis([48, 55], 0.2)!;
    expect(loose.domain[1] - loose.domain[0]).toBeGreaterThan(tight.domain[1] - tight.domain[0]);
    expect(tight.domain[1]).toBeCloseTo(55.14, 5);
    expect(loose.domain[1]).toBeCloseTo(56.4, 5);
  });
});
