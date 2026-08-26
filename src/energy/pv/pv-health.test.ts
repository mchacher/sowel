import { describe, expect, it } from "vitest";
import {
  ALERT_DAYS,
  ALERT_MARGIN,
  MIN_NORMAL_DAYS,
  assess,
  dailyRatio,
  deficitAgainst,
  detectionSpeed,
  qualifies,
  rollingNormal,
  shouldResolve,
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
    expect(r.irradiationWhM2).toBe(5 * 800);
  });
});

const day = (d: string, ratio: number): DayRatio => ({
  day: d,
  ratio,
  hours: 5,
  measuredWh: ratio * 4000,
  irradiationWhM2: 4000,
});

/** `n` consecutive qualifying days at `ratio`, starting `from` days after epoch. */
const run = (n: number, ratio: number, from = 1): DayRatio[] =>
  Array.from({ length: n }, (_, i) =>
    day(new Date(Date.UTC(2026, 0, from + i)).toISOString().slice(0, 10), ratio),
  );

describe("rollingNormal", () => {
  it("says nothing until there is enough history", () => {
    // Thirty qualifying days, which is a couple of summer months. A reference
    // built on less would be an opinion about the weather.
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

  it("sits near the top of the window, not in the middle", () => {
    // "What this array is capable of", not "what it typically does". A dirty
    // fortnight must not become the standard it is held to.
    const mixed = [...run(MIN_NORMAL_DAYS, 4.0), ...run(10, 3.0, 40)];
    const ref = rollingNormal(mixed)!;
    expect(ref).toBeCloseTo(4.0, 6);
  });

  it("is not dragged down by a fault filling a fifth of the window", () => {
    // The measured failure of the previous design: a 20-day median caught 7 % of
    // a real eight-month outage because the fault became the reference. A fifth
    // of the window cannot move an 80th centile.
    const faultDays = Math.floor(MIN_NORMAL_DAYS / 5);
    const withFault = [...run(MIN_NORMAL_DAYS, 4.0), ...run(faultDays, 3.0, 60)];
    expect(rollingNormal(withFault)!).toBeCloseTo(4.0, 6);
  });

  it("reports a sustained decline rather than absorbing it", () => {
    // Soiling used to be swallowed by a rolling median, so panels quietly lost
    // ten percent and nothing said so. Now the reference holds and the deficit
    // shows.
    const clean = run(MIN_NORMAL_DAYS + 20, 4.0);
    const dirty = [...clean, ...run(ALERT_DAYS, 3.5, 80)];
    const v = assess(dirty);
    expect(v.normal).toBeCloseTo(4.0, 6);
    expect(v.alerting).toBe(true);
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
    expect(v.since).toBe(faulty[faulty.length - ALERT_DAYS].day);
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

describe("shouldResolve", () => {
  const frozen = 4.0;
  const up = (n: number) => run(n, 3.7, 80);
  const down = (n: number) => run(n, 3.2, 80);

  it("clears after a full run of qualifying days above the threshold", () => {
    expect(shouldResolve(frozen, [...down(3), ...run(ALERT_DAYS, 3.7, 90)])).toBe(true);
  });

  it("does not clear on a single good day — symmetric with the raise", () => {
    // The flapping this kills: an 11 % fault against a 10 % margin on a 4.3 %
    // noise floor got one lucky day every few clear days, resolved, then
    // re-raised — a raise/recovery notification pair all season.
    expect(shouldResolve(frozen, [...down(2), ...up(1)])).toBe(false);
    expect(shouldResolve(frozen, [...up(1), ...down(1), ...up(1)])).toBe(false);
  });

  it("does not clear while any recent day is still below", () => {
    expect(shouldResolve(frozen, [...up(2), ...down(1)])).toBe(false);
  });

  it("does not clear when there is nothing recent to judge on", () => {
    // Losing the ability to measure is not recovery, and announcing it as such
    // is worse than silence. A fortnight of overcast, or a meter that stopped
    // reporting, produces exactly this state.
    expect(shouldResolve(frozen, [])).toBe(false);
    expect(shouldResolve(frozen, up(ALERT_DAYS - 1))).toBe(false);
  });

  it("refuses a nonsense frozen normal rather than clearing on it", () => {
    expect(shouldResolve(0, up(ALERT_DAYS))).toBe(false);
    expect(shouldResolve(Number.NaN, up(ALERT_DAYS))).toBe(false);
  });

  it("is judged against the frozen normal, never a recomputed one", () => {
    // A rolling reference absorbs a sustained fault; a run of days at the fault
    // level must never clear against the normal the alert was raised with.
    const stillFaulty = run(ALERT_DAYS, 3.0, 90);
    expect(shouldResolve(frozen, stillFaulty)).toBe(false);
    // ...even though a normal recomputed over those days would say fine.
    expect(shouldResolve(3.0, stillFaulty)).toBe(true);
  });

  it("clears easily after a real repair, which jumps far above the threshold", () => {
    // One panel back in five is +20 %: every following clear day sits well over
    // the 90 % line, so the symmetric rule costs a couple of clear days, not a
    // season.
    expect(shouldResolve(frozen, [...down(5), ...run(ALERT_DAYS, 4.1, 95)])).toBe(true);
  });
});

describe("deficitAgainst", () => {
  it("measures the recent days against the frozen normal", () => {
    expect(deficitAgainst(4.0, run(ALERT_DAYS, 3.0, 21))).toBeCloseTo(0.25, 6);
  });

  it("is zero rather than negative when production is above it", () => {
    expect(deficitAgainst(4.0, run(ALERT_DAYS, 4.4, 21))).toBe(0);
  });

  it("is zero with nothing to measure", () => {
    expect(deficitAgainst(4.0, [])).toBe(0);
    expect(deficitAgainst(0, run(ALERT_DAYS, 3.0, 21))).toBe(0);
  });
});

describe("detectionSpeed", () => {
  it("is slower when clear days are rare", () => {
    // Same rule, different weather: December must not claim July's confidence.
    expect(detectionSpeed(4, 14)!.calendarDays).toBeGreaterThan(
      detectionSpeed(12, 14)!.calendarDays,
    );
  });

  it("states the smallest loss it can confirm at all", () => {
    // The honest form of "how sensitive is this". Anything shallower than the
    // margin is never raised, however long one waits.
    expect(detectionSpeed(10, 14)!.minDetectableLoss).toBe(ALERT_MARGIN);
  });

  it("never reports an infinity, since it names no panel count", () => {
    // The previous form divided the peak power by an assumed 500 Wc to guess a
    // panel count, and on a 5 kWc array a single panel fell under the margin so
    // the card printed a dash where a duration belonged.
    for (const [q, w] of [
      [1, 45],
      [10, 14],
      [45, 45],
    ]) {
      expect(Number.isFinite(detectionSpeed(q, w)!.calendarDays)).toBe(true);
    }
  });

  it("returns null rather than an infinity dressed as a number", () => {
    expect(detectionSpeed(0, 14)).toBeNull();
    expect(detectionSpeed(5, 0)).toBeNull();
  });

  it("carries what it was computed from, so the card can show its working", () => {
    const s = detectionSpeed(7, 14)!;
    expect(s.qualifyingDays).toBe(7);
    expect(s.windowDays).toBe(14);
  });
});
