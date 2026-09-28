/**
 * Spec 181 R7.29 — the period is picked in order: the day from a calendar
 * where every day before the start is refused, the time from two lists (hours,
 * minutes in steps of five) with the values before the start disabled on its
 * day, and moving the start past the end carries the end along.
 */
import { describe, it, expect } from "vitest";
import {
  type Bounds,
  type ValidityDraft,
  MINUTES,
  checkValidity,
  compareWall,
  hourOptions,
  isDayAllowed,
  isoToWall,
  minuteOptions,
  moveStart,
  roundUpToStep,
  snapInto,
  validityBody,
  validityFromView,
} from "./shared-access-period";

const start = { date: "2026-10-03", time: "16:20" };
const afterStart: Bounds = { min: start, minStrict: true };

describe("the lists of the end picker", () => {
  it("offers minutes in steps of five", () => {
    expect(MINUTES).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(minuteOptions("2026-10-05", 9, afterStart).map((o) => o.value)).toEqual(MINUTES);
  });

  it("disables the hours before the start on the start's day", () => {
    const hours = hourOptions("2026-10-03", afterStart);
    expect(hours.filter((h) => h.disabled).map((h) => h.value)).toEqual(
      Array.from({ length: 16 }, (_, h) => h),
    );
    expect(hours.find((h) => h.value === 16)?.disabled).toBe(false);
    expect(hours.find((h) => h.value === 23)?.disabled).toBe(false);
  });

  it("disables the minutes up to the start in the start's hour — the end is strictly after", () => {
    const minutes = minuteOptions("2026-10-03", 16, afterStart);
    expect(minutes.filter((m) => m.disabled).map((m) => m.value)).toEqual([0, 5, 10, 15, 20]);
    expect(minutes.find((m) => m.value === 25)?.disabled).toBe(false);
  });

  it("disables nothing on a later day", () => {
    expect(hourOptions("2026-10-04", afterStart).some((h) => h.disabled)).toBe(false);
    expect(minuteOptions("2026-10-04", 0, afterStart).some((m) => m.disabled)).toBe(false);
  });

  it("disables an hour whose every minute is at or before the start", () => {
    const late = { min: { date: "2026-10-03", time: "16:55" }, minStrict: true };
    expect(hourOptions("2026-10-03", late).find((h) => h.value === 16)?.disabled).toBe(true);
  });

  it("keeps an off-grid minute the server holds, instead of changing it silently", () => {
    const values = minuteOptions("2026-10-05", 9, {}, 17).map((o) => o.value);
    expect(values).toContain(17);
    expect(values).toContain(15);
    expect(values).toContain(20);
  });

  it("refuses every day before the start, and accepts the start's own day", () => {
    expect(isDayAllowed("2026-10-02", afterStart)).toBe(false);
    expect(isDayAllowed("2026-10-03", afterStart)).toBe(true);
    expect(isDayAllowed("2026-10-10", afterStart)).toBe(true);
  });

  it("refuses the days after an upper bound (open earlier: widen only)", () => {
    const early: Bounds = { max: start };
    expect(isDayAllowed("2026-10-04", early)).toBe(false);
    expect(hourOptions("2026-10-03", early).find((h) => h.value === 17)?.disabled).toBe(true);
    expect(minuteOptions("2026-10-03", 16, early).find((m) => m.value === 20)?.disabled).toBe(false);
    expect(minuteOptions("2026-10-03", 16, early).find((m) => m.value === 25)?.disabled).toBe(true);
  });
});

describe("snapping a value into its bounds", () => {
  it("moves a time before the start on its day to the first slot after it", () => {
    expect(snapInto({ date: "2026-10-03", time: "09:00" }, afterStart)).toEqual({
      date: "2026-10-03",
      time: "16:25",
    });
  });

  it("goes to the next day when nothing is left on the start's day", () => {
    const b: Bounds = { min: { date: "2026-10-03", time: "23:55" }, minStrict: true };
    expect(snapInto({ date: "2026-10-03", time: "10:00" }, b)).toEqual({
      date: "2026-10-04",
      time: "00:00",
    });
  });

  it("leaves a value that fits alone", () => {
    const w = { date: "2026-10-05", time: "07:35" };
    expect(snapInto(w, afterStart)).toBe(w);
  });
});

describe("moving the start", () => {
  const end = { date: "2026-10-07", time: "11:00" };

  it("leaves the end alone while the start stays before it", () => {
    expect(moveStart(start, { date: "2026-10-05", time: "08:00" }, end)).toBe(end);
  });

  it("carries the end along past it, keeping the length", () => {
    const moved = moveStart(start, { date: "2026-10-10", time: "16:20" }, end);
    // 3 Oct 16:20 → 7 Oct 11:00 is 3 days 18 h 40 min.
    expect(moved).toEqual({ date: "2026-10-14", time: "11:00" });
  });

  it("carries the end when the start lands exactly on it", () => {
    const moved = moveStart(start, end, end);
    expect(moved).not.toBeNull();
    expect(compareWall(moved!, end)).toBeGreaterThan(0);
  });

  it("is not shifted by a DST change: the wall clock is a calendar here", () => {
    const s = { date: "2026-10-24", time: "12:00" };
    const e = { date: "2026-10-26", time: "12:00" };
    expect(moveStart(s, { date: "2026-10-27", time: "12:00" }, e)).toEqual({
      date: "2026-10-29",
      time: "12:00",
    });
  });
});

describe("a period with one bound only", () => {
  it("has no end to carry when the access runs « from » a date only", () => {
    expect(moveStart(start, { date: "2026-10-10", time: "08:00" }, null)).toBeNull();
  });

  it("keeps the missing bound missing when read from the server", () => {
    const fromOnly = validityFromView(
      { validFrom: "2026-10-03T14:20:00.000Z", validUntil: null, timeWindows: [] },
      "Europe/Paris",
    );
    expect(fromOnly).toMatchObject({ period: true, from: start, until: null });
    const untilOnly = validityFromView(
      { validFrom: null, validUntil: "2026-10-03T14:20:00.000Z", timeWindows: [] },
      "Europe/Paris",
    );
    expect(untilOnly).toMatchObject({ period: true, from: null, until: start });
  });

  it("sends a missing bound as null, and checks no order without both", () => {
    const v: ValidityDraft = { period: true, from: start, until: null, ranges: false, windows: [] };
    expect(validityBody(v)).toEqual({ validFrom: "2026-10-03T16:20", validUntil: null, timeWindows: [] });
    expect(checkValidity(v)).toBeNull();
    expect(checkValidity({ ...v, from: null, until: start })).toBeNull();
  });

  it("leaves out of the body a bound the owner did not change", () => {
    const initial: ValidityDraft = { period: true, from: start, until: null, ranges: false, windows: [] };
    expect(validityBody({ ...initial }, initial)).toEqual({ timeWindows: [] });
    // Changing the start sends the start alone.
    const moved = { ...initial, from: { date: "2026-10-04", time: "09:00" } };
    expect(validityBody(moved, initial)).toEqual({ validFrom: "2026-10-04T09:00", timeWindows: [] });
    // « Tout le temps » clears the bound that was held, and only that one.
    expect(validityBody({ ...initial, period: false }, initial)).toEqual({ validFrom: null, timeWindows: [] });
  });

  it("offers a fresh day for an access held « tout le temps », without sending it", () => {
    const always = validityFromView({ validFrom: null, validUntil: null, timeWindows: [] }, "Europe/Paris");
    expect(always.period).toBe(false);
    expect(always.from).not.toBeNull();
    expect(always.until).not.toBeNull();
    expect(validityBody(always, always)).toEqual({ timeWindows: [] });
  });
});

describe("the two validity groups", () => {
  const base: ValidityDraft = {
    period: false,
    from: start,
    until: { date: "2026-10-07", time: "11:00" },
    ranges: false,
    windows: [],
  };

  it("stores no date and no hour for « Tout le temps » and « Toute la journée »", () => {
    expect(validityBody({ ...base, windows: [{ from: "08:00", to: "20:00" }] })).toEqual({
      validFrom: null,
      validUntil: null,
      timeWindows: [],
    });
  });

  it("sends the house's wall clock, not an instant", () => {
    expect(validityBody({ ...base, period: true })).toMatchObject({
      validFrom: "2026-10-03T16:20",
      validUntil: "2026-10-07T11:00",
    });
  });

  it("refuses what the server refuses", () => {
    expect(checkValidity({ ...base, period: true, until: start })?.code).toBe("end_before_start");
    expect(checkValidity({ ...base, ranges: true, windows: [{ from: "8h", to: "20:00" }] })?.code).toBe(
      "invalid_hours",
    );
    expect(
      checkValidity({ ...base, ranges: true, windows: [{ from: "22:00", to: "06:00" }] })?.code,
    ).toBe("window_crosses_midnight");
    expect(
      checkValidity({
        ...base,
        ranges: true,
        windows: [
          { from: "08:00", to: "12:00" },
          { from: "11:00", to: "14:00" },
        ],
      })?.code,
    ).toBe("windows_overlap");
    expect(checkValidity({ ...base, ranges: true, windows: [{ from: "08:00", to: "20:00" }] })).toBeNull();
  });
});

describe("the house's clock", () => {
  it("reads an instant on the house's wall clock", () => {
    expect(isoToWall("2026-10-03T14:20:00.000Z", "Europe/Paris")).toEqual(start);
  });

  it("rounds up to the next step of five", () => {
    expect(roundUpToStep({ date: "2026-10-03", time: "23:58" })).toEqual({
      date: "2026-10-04",
      time: "00:00",
    });
  });
});
