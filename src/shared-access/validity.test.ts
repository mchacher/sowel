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
