import { describe, expect, it } from "vitest";
import {
  ALERT_DAYS,
  ALERT_MARGIN,
  MIN_NORMAL_DAYS,
  assess,
  dailyRatio,
  detectionSpeed,
  qualifies,
  rollingNormal,
  type DayRatio,
  type HealthHour,
} from "./pv-health.js";

const hour = (over: Partial<HealthHour> = {}): HealthHour => ({
  hourLocal: 12,
  poa: 800,
  watts: 3000,
  directFraction: 0.9,
  ...over,
});

describe("qualifies", () => {
  it("accepts a clear midday hour", () => {
    expect(qualifies(hour())).toBe(true);
  });

  it("rejects an hour outside the midday band", () => {
    // Outside 10-16 the day-to-day noise doubles, which is the whole reason the
    // band exists.
    expect(qualifies(hour({ hourLocal: 9 }))).toBe(false);
    expect(qualifies(hour({ hourLocal: 17 }))).toBe(false);
  });

  it("takes both edges of the band", () => {
    expect(qualifies(hour({ hourLocal: 10 }))).toBe(true);
    expect(qualifies(hour({ hourLocal: 16 }))).toBe(true);
  });

  it("rejects an hour below the beam threshold", () => {
    expect(qualifies(hour({ directFraction: 0.7 }))).toBe(false);
  });

  it("never treats an unknown fraction as clear", () => {
    // Rows written before migration 027 have none. Admitting them would let
    // every overcast hour in the existing window through on the first run.
    expect(qualifies(hour({ directFraction: null }))).toBe(false);
    expect(qualifies(hour({ directFraction: Number.NaN }))).toBe(false);
  });

  it("rejects an hour with no irradiance to divide by", () => {
    expect(qualifies(hour({ poa: 0 }))).toBe(false);
    expect(qualifies(hour({ poa: Number.NaN }))).toBe(false);
  });

  it("rejects a non-finite or negative reading", () => {
    expect(qualifies(hour({ watts: Number.NaN }))).toBe(false);
    expect(qualifies(hour({ watts: -10 }))).toBe(false);
  });

  it("accepts a zero reading, which is a real and alarming measurement", () => {
    expect(qualifies(hour({ watts: 0 }))).toBe(true);
  });
});

describe("dailyRatio", () => {
  const clearHours = (n: number, watts = 3000): HealthHour[] =>
    Array.from({ length: n }, (_, i) => hour({ hourLocal: 10 + i, watts }));

  it("produces a ratio from enough qualifying hours", () => {
    const r = dailyRatio("2026-08-25", clearHours(5));
    expect(r).not.toBeNull();
    expect(r?.hours).toBe(5);
    expect(r?.ratio).toBeCloseTo(3000 / 800, 6);
  });

  it("returns null rather than a low ratio when the day is too short", () => {
    // Too few clear hours is missing information, never bad performance. Storing
    // it as the latter is how a monitor learns to cry wolf every December.
    expect(dailyRatio("2026-08-25", clearHours(3))).toBeNull();
  });

  it("counts only the qualifying hours, not every hour of the day", () => {
    const mixed = [...clearHours(4), hour({ hourLocal: 8 }), hour({ directFraction: 0.2 })];
    expect(dailyRatio("2026-08-25", mixed)?.hours).toBe(4);
  });

  it("returns null when there is no irradiance to divide by", () => {
    const zeroed = clearHours(5).map((h) => ({ ...h, poa: 0 }));
    expect(dailyRatio("2026-08-25", zeroed)).toBeNull();
  });

  it("falls with production, which is the point", () => {
    const full = dailyRatio("2026-08-25", clearHours(6, 3000))!;
    const degraded = dailyRatio("2026-08-25", clearHours(6, 2625))!;
    expect(degraded.ratio / full.ratio).toBeCloseTo(0.875, 6);
  });

  it("is unmoved by the model, since the denominator is irradiance", () => {
    // A nightly refit changes the fitted gain. It must not move this ratio, or
    // the detector jumps at its own shadow.
    const r = dailyRatio("2026-08-25", clearHours(5))!;
    expect(r.modelledWh).toBe(5 * 800);
  });
});

const day = (d: string, ratio: number): DayRatio => ({
  day: d,
  ratio,
  hours: 5,
  measuredWh: ratio * 4000,
  modelledWh: 4000,
});

/** `n` days at `ratio`, dated consecutively from 2026-07-01. */
const run = (n: number, ratio: number, from = 1): DayRatio[] =>
  Array.from({ length: n }, (_, i) => day(`2026-07-${String(from + i).padStart(2, "0")}`, ratio));

describe("rollingNormal", () => {
  it("says nothing until there is enough history", () => {
    expect(rollingNormal(run(MIN_NORMAL_DAYS - 1, 3.8))).toBeNull();
  });

  it("returns the median once there is", () => {
    expect(rollingNormal(run(MIN_NORMAL_DAYS, 3.8))).toBeCloseTo(3.8, 6);
  });

  it("is unmoved by a single anomalous day", () => {
    // Mean would be dragged; the reference a day is about to be judged against
    // must not follow that day.
    const withOutlier = [...run(MIN_NORMAL_DAYS, 3.8), day("2026-07-30", 0.4)];
    expect(rollingNormal(withOutlier)).toBeCloseTo(3.8, 6);
  });

  it("ignores non-finite and non-positive ratios", () => {
    const dirty = [
      ...run(MIN_NORMAL_DAYS, 3.8),
      day("2026-07-30", Number.NaN),
      day("2026-07-31", 0),
    ];
    expect(rollingNormal(dirty)).toBeCloseTo(3.8, 6);
  });

  it("follows a slow drift, which is soiling", () => {
    const drifting = Array.from({ length: 20 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, "0")}`, 3.8 - i * 0.01),
    );
    const early = rollingNormal(drifting.slice(0, 10));
    const late = rollingNormal(drifting);
    expect(early).not.toBeNull();
    expect(late!).toBeLessThan(early!);
  });
});

describe("assess", () => {
  const healthy = run(MIN_NORMAL_DAYS + ALERT_DAYS, 4.0);

  it("says nothing while there is no normal", () => {
    const v = assess(run(4, 4.0));
    expect(v.normal).toBeNull();
    expect(v.alerting).toBe(false);
  });

  it("stays quiet on a healthy run", () => {
    expect(assess(healthy).alerting).toBe(false);
  });

  it("raises after a sustained deficit", () => {
    const faulty = [...run(MIN_NORMAL_DAYS, 4.0), ...run(ALERT_DAYS, 3.4, 21)];
    const v = assess(faulty);
    expect(v.alerting).toBe(true);
    expect(v.deficit).toBeCloseTo(0.15, 2);
    expect(v.since).toBe("2026-07-21");
  });

  it("does not raise on a deficit inside the margin", () => {
    // 8 % is ordinary variation on a 4.3 % noise floor.
    const marginal = [...run(MIN_NORMAL_DAYS, 4.0), ...run(ALERT_DAYS, 3.68, 21)];
    expect(assess(marginal).alerting).toBe(false);
  });

  it("needs consecutive days, not a bad day among good ones", () => {
    const flapping = [
      ...run(MIN_NORMAL_DAYS, 4.0),
      day("2026-07-21", 3.2),
      day("2026-07-22", 4.0),
      day("2026-07-23", 3.2),
    ];
    expect(assess(flapping).alerting).toBe(false);
  });

  it("clears once a qualifying day comes back", () => {
    const recovered = [
      ...run(MIN_NORMAL_DAYS, 4.0),
      day("2026-07-21", 3.2),
      day("2026-07-22", 3.2),
      day("2026-07-23", 4.0),
    ];
    expect(assess(recovered).alerting).toBe(false);
  });

  it("judges against a normal that excludes the days under assessment", () => {
    // The failure this guards: a sustained fault dragging down the very baseline
    // that would reveal it, so the alert never fires.
    const faulty = [...run(MIN_NORMAL_DAYS, 4.0), ...run(ALERT_DAYS, 3.0, 21)];
    const v = assess(faulty);
    expect(v.normal).toBeCloseTo(4.0, 6);
    expect(v.alerting).toBe(true);
  });

  it("reports the most recent day whether or not it is alerting", () => {
    expect(assess(healthy).latest?.day).toBe(healthy[healthy.length - 1].day);
    expect(assess([]).latest).toBeNull();
  });
});

describe("detectionSpeed", () => {
  it("is faster when clear days are frequent", () => {
    const often = detectionSpeed(12, 14, 8)!;
    const rarely = detectionSpeed(4, 14, 8)!;
    // Same rule, different weather: December must not claim July's confidence.
    expect(rarely.onePanelDays).toBeGreaterThan(often.onePanelDays);
  });

  it("confirms a whole inverter sooner than a single panel", () => {
    const s = detectionSpeed(6, 14, 8)!;
    expect(s.oneInverterDays).toBeLessThanOrEqual(s.onePanelDays);
  });

  it("says a loss inside the margin is never confirmed, rather than inventing a number", () => {
    // One panel of twenty is 5 %, below the 10 % margin: no amount of waiting
    // raises it, and the card must not pretend otherwise.
    const s = detectionSpeed(10, 14, 20)!;
    expect(s.onePanelDays).toBe(Number.POSITIVE_INFINITY);
    expect(1 / 20).toBeLessThan(ALERT_MARGIN);
  });

  it("returns null rather than an infinity dressed as a number", () => {
    expect(detectionSpeed(0, 14, 8)).toBeNull();
    expect(detectionSpeed(5, 0, 8)).toBeNull();
    expect(detectionSpeed(5, 14, 0)).toBeNull();
  });

  it("carries what it was computed from, so the card can show its working", () => {
    const s = detectionSpeed(7, 14, 8)!;
    expect(s.qualifyingDays).toBe(7);
    expect(s.windowDays).toBe(14);
  });
});
