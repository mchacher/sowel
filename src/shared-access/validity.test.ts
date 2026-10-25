import { describe, it, expect } from "vitest";
import {
  accessStatus,
  checkPeriod,
  decide,
  inTimeWindows,
  nextWindowOpening,
  parseInstant,
  validateTimeWindows,
  type ValidityFacts,
} from "./validity.js";

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

function facts(over: Partial<ValidityFacts> = {}): ValidityFacts {
  return {
    validFrom: null,
    validUntil: null,
    timeWindows: [],
    suspendedAt: null,
    revokedAt: null,
    gateIds: ["g1"],
    ...over,
  };
}
const armed = () => true;

describe("validity (R3.10)", () => {
  it("accepts time windows, sorted", () => {
    expect(
      validateTimeWindows([
        { from: "18:00", to: "20:00" },
        { from: "08:00", to: "12:00" },
      ]),
    ).toEqual([
      { from: "08:00", to: "12:00" },
      { from: "18:00", to: "20:00" },
    ]);
    expect(validateTimeWindows(undefined)).toEqual([]);
  });

  it("refuses a window crossing midnight, overlapping windows, and unreadable hours", () => {
    expect(() => validateTimeWindows([{ from: "22:00", to: "02:00" }])).toThrow(/midnight/);
    expect(() =>
      validateTimeWindows([
        { from: "10:00", to: "12:00" },
        { from: "11:00", to: "13:00" },
      ]),
    ).toThrow(/overlap/);
    expect(() => validateTimeWindows([{ from: "8h", to: "12:00" }])).toThrow();
  });

  it("refuses an end before the start (end_before_start)", () => {
    expect(() => checkPeriod(at(10, 12), at(5, 12))).toThrow(
      expect.objectContaining({ code: "end_before_start" }),
    );
    expect(() => checkPeriod(null, at(5, 12))).not.toThrow();
  });

  it("reads a date and hour without offset on the house's clock", () => {
    expect(parseInstant("2026-10-03T16:00", "from")).toBe(at(3, 16));
    // A date alone is the house's midnight, not UTC's.
    expect(parseInstant("2026-10-03", "from")).toBe(at(3, 0));
    // A date no Date can write back is refused: one such row would break every list.
    expect(() => parseInstant(1e16, "from")).toThrow();
    expect(() => parseInstant("+275760-09-14T00:00:00.001Z", "from")).toThrow();
    expect(parseInstant(null, "from")).toBeNull();
    expect(() => parseInstant("tomorrow", "from")).toThrow();
  });

  it("knows whether an instant is inside a window, and when the next one opens", () => {
    const w = [{ from: "08:00", to: "20:00" }];
    expect(inTimeWindows(w, at(3, 7, 59))).toBe(false);
    expect(inTimeWindows(w, at(3, 8))).toBe(true);
    expect(inTimeWindows(w, at(3, 20))).toBe(false);
    expect(nextWindowOpening(w, at(3, 6))).toBe(at(3, 8));
    expect(nextWindowOpening(w, at(3, 21))).toBe(at(4, 8));
    expect(inTimeWindows([], at(3, 3))).toBe(true);
  });
});

describe("the decision (R4.12)", () => {
  it("before, inside and after the period give the matching answer", () => {
    const f = facts({ validFrom: at(3, 16), validUntil: at(7, 11) });
    expect(decide(f, "g1", at(3, 15), armed)).toEqual({
      ok: false,
      reason: "not_yet",
      activeAt: at(3, 16),
    });
    expect(decide(f, "g1", at(5, 12), armed)).toEqual({ ok: true });
    expect(decide(f, "g1", at(7, 11), armed)).toEqual({ ok: false, reason: "expired" });
  });

  it("outside a time window says when it opens next", () => {
    const f = facts({ timeWindows: [{ from: "08:00", to: "20:00" }] });
    expect(decide(f, "g1", at(3, 22), armed)).toEqual({
      ok: false,
      reason: "outside_hours",
      nextOpeningAt: at(4, 8),
    });
  });

  it("keeps R4.12's order: revoked before suspended before dates before hours before gate before arming", () => {
    const all = facts({
      revokedAt: 1,
      suspendedAt: 1,
      validFrom: at(9, 0),
      timeWindows: [{ from: "08:00", to: "09:00" }],
    });
    expect(decide(all, "other", at(3, 22), () => false)).toMatchObject({ reason: "revoked" });
    expect(decide({ ...all, revokedAt: null }, "other", at(3, 22), () => false)).toMatchObject({
      reason: "suspended",
    });
    expect(
      decide({ ...all, revokedAt: null, suspendedAt: null }, "other", at(3, 22), () => false),
    ).toMatchObject({ reason: "not_yet" });
    const inDates = { ...all, revokedAt: null, suspendedAt: null, validFrom: null };
    expect(decide(inDates, "other", at(3, 22), () => false)).toMatchObject({
      reason: "outside_hours",
    });
    const inHours = { ...inDates, timeWindows: [] };
    expect(decide(inHours, "other", at(3, 22), () => false)).toMatchObject({
      reason: "not_this_gate",
    });
    expect(decide(inHours, "g1", at(3, 22), () => false)).toMatchObject({
      reason: "refused_by_house",
    });
    expect(decide({ ...inHours, gateIds: [] }, "g1", at(3, 22), armed)).toMatchObject({
      reason: "no_gate",
    });
  });

  it("gives each access a status for the owner's line", () => {
    expect(accessStatus(facts(), at(3, 12))).toBe("live");
    expect(accessStatus(facts({ validUntil: at(3, 11) }), at(3, 12))).toBe("ended");
    expect(accessStatus(facts({ revokedAt: 1 }), at(3, 12))).toBe("revoked");
    expect(accessStatus(facts({ suspendedAt: 1 }), at(3, 12))).toBe("suspended");
    expect(accessStatus(facts({ gateIds: [] }), at(3, 12))).toBe("no_gate");
  });
});

describe("days of the week on the windows (spec 187)", () => {
  // October 2026: the 2nd is a Friday, the 3rd a Saturday, the 5th a Monday.
  const friday = [{ from: "18:00", to: "22:00", days: [5] }];

  it("is inside on the named day only", () => {
    expect(inTimeWindows(friday, at(2, 19))).toBe(true);
    expect(inTimeWindows(friday, at(1, 19))).toBe(false); // Thursday
    expect(inTimeWindows(friday, at(3, 19))).toBe(false); // Saturday
  });

  it("reads a window with no days as every day, as before", () => {
    const w = [{ from: "08:00", to: "20:00" }];
    for (const day of [1, 2, 3, 4, 5, 6, 7]) expect(inTimeWindows(w, at(day, 9))).toBe(true);
  });

  it("opens next on the named day, today after now, a week on when today's has passed", () => {
    expect(nextWindowOpening(friday, at(2, 17))).toBe(at(2, 18)); // Friday before
    expect(nextWindowOpening(friday, at(1, 20))).toBe(at(2, 18)); // Thursday evening
    expect(nextWindowOpening(friday, at(3, 10))).toBe(at(9, 18)); // Saturday → next Friday
    expect(nextWindowOpening(friday, at(2, 23))).toBe(at(9, 18)); // Friday past the end
  });

  it("picks the earliest start among the windows of the coming days", () => {
    const w = [
      { from: "18:00", to: "22:00", days: [5] },
      { from: "08:00", to: "12:00", days: [6] },
    ];
    expect(nextWindowOpening(w, at(2, 23))).toBe(at(3, 8));
  });

  it("refuses an empty, unreal or unlisted days value rather than reading it as every day", () => {
    for (const days of [[], [0], [8], [1.5], "5", [null]]) {
      expect(() => validateTimeWindows([{ from: "08:00", to: "12:00", days }])).toThrow(/day/);
    }
  });

  it("lets two windows overlap in hours when they share no day, and refuses it when they do", () => {
    expect(
      validateTimeWindows([
        { from: "08:00", to: "12:00", days: [2] },
        { from: "10:00", to: "14:00", days: [5] },
      ]),
    ).toHaveLength(2);
    expect(() =>
      validateTimeWindows([
        { from: "08:00", to: "12:00", days: [2, 5] },
        { from: "10:00", to: "14:00", days: [5] },
      ]),
    ).toThrow(/overlap/);
    expect(() =>
      validateTimeWindows([
        { from: "08:00", to: "12:00" },
        { from: "10:00", to: "14:00", days: [3] },
      ]),
    ).toThrow(/overlap/);
  });

  it("stores the days sorted and unique, and all seven as none", () => {
    expect(validateTimeWindows([{ from: "18:00", to: "22:00", days: [7, 5, 5] }])).toEqual([
      { from: "18:00", to: "22:00", days: [5, 7] },
    ]);
    expect(
      validateTimeWindows([{ from: "08:00", to: "20:00", days: [1, 2, 3, 4, 5, 6, 7] }]),
    ).toEqual([{ from: "08:00", to: "20:00" }]);
  });

  it("refuses a press outside the day and names the next opening", () => {
    const f = facts({ timeWindows: friday });
    expect(decide(f, "g1", at(1, 19), armed)).toEqual({
      ok: false,
      reason: "outside_hours",
      nextOpeningAt: at(2, 18),
    });
    expect(decide(f, "g1", at(2, 19), armed)).toEqual({ ok: true });
    expect(accessStatus(f, at(3, 19))).toBe("outside_hours");
  });

  it("fails shut on a stored row whose days are not a list of days", () => {
    // A restored backup or a hand-edited row: never « every day ».
    for (const days of [[], "5", null, { 0: 5 }, [0], ["5"]]) {
      const w = [{ from: "18:00", to: "22:00", days }] as unknown as Array<{
        from: string;
        to: string;
      }>;
      expect(inTimeWindows(w, at(1, 19))).toBe(false);
    }
  });

  it("does not promise an opening past the end of the access", () => {
    const f = facts({ timeWindows: friday, validUntil: at(8, 0) });
    expect(decide(f, "g1", at(3, 19), armed)).toEqual({ ok: false, reason: "outside_hours" });
  });
});
