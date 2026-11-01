import { describe, expect, it } from "vitest";
import {
  attribute,
  emptyEvidence,
  foldReport,
  type ReportAlias,
  type VehicleEvidence,
} from "./attribution.js";

const START = Date.UTC(2026, 10, 1, 18, 0, 0);
const END = START + 6 * 3_600_000;
const H = 3_600_000;

function fold(
  vehicleId: string,
  reports: Array<[ReportAlias, unknown, number]>,
  session: { startMs: number; endMs: number | null } = { startMs: START, endMs: END },
): VehicleEvidence {
  return reports.reduce(
    (ev, [alias, value, at]) =>
      foldReport(ev, { alias, value, reportedAtMs: at, receivedAtMs: at }, session),
    emptyEvidence(vehicleId),
  );
}

describe("attribute", () => {
  it("attributes to the one car seen plugged and charging", () => {
    const rafale = fold("rafale", [
      ["plugged", true, START + H],
      ["charging_state", "charging", START + H],
    ]);
    const megane = fold("megane", [["plugged", false, START + H]]);
    expect(attribute([rafale, megane], ["rafale", "megane"])).toEqual({
      state: "vehicle",
      vehicleId: "rafale",
      reason: "single-match",
    });
  });

  it("attributes on a battery rise when the charging state contradicts (Megane flap code)", () => {
    const megane = fold("megane", [
      ["plugged", true, START + H],
      ["charging_state", "unplugged", START + H],
      ["battery_level", 40, START + H],
      ["battery_level", 55, START + 3 * H],
    ]);
    const rafale = emptyEvidence("rafale");
    expect(attribute([megane, rafale], ["megane", "rafale"])).toMatchObject({
      state: "vehicle",
      vehicleId: "megane",
    });
  });

  it("leaves the session to attribute when both cars match", () => {
    const a = fold("a", [["charging_state", "charging", START + H]]);
    const b = fold("b", [["charging_state", "charging", START + 2 * H]]);
    expect(attribute([a, b], ["a", "b"])).toEqual({
      state: "unattributed",
      reason: "several-matches",
    });
  });

  it("leaves the session to attribute when no car matches", () => {
    expect(attribute([emptyEvidence("a"), emptyEvidence("b")], ["a", "b"])).toEqual({
      state: "unattributed",
      reason: "no-match",
    });
  });

  it("attributes to the only vehicle even without any report", () => {
    expect(attribute([], ["solo"])).toEqual({
      state: "vehicle",
      vehicleId: "solo",
      reason: "only-vehicle",
    });
  });

  it("does not attribute to the only vehicle when it was away", () => {
    const solo = fold("solo", [["at_home", false, START + H]]);
    expect(attribute([solo], ["solo"])).toEqual({ state: "unattributed", reason: "no-match" });
  });

  it("ignores a battery jitter of one point", () => {
    const a = fold("a", [
      ["battery_level", 40, START + H],
      ["battery_level", 41, START + 2 * H],
    ]);
    expect(attribute([a, emptyEvidence("b")], ["a", "b"]).state).toBe("unattributed");
  });

  it("ignores evidence of a vehicle that no longer exists", () => {
    const gone = fold("gone", [["charging_state", "charging", START + H]]);
    const kept = fold("kept", [["charging_state", "charging", START + H]]);
    expect(attribute([gone, kept], ["kept", "other"])).toMatchObject({ vehicleId: "kept" });
  });
});

describe("foldReport", () => {
  it("ignores a report the car made before the session started", () => {
    const ev = fold("a", [["charging_state", "charging", START - 60_000]]);
    expect(ev.chargingSeen).toBe(false);
  });

  it("counts a report received late when the car made it during the session", () => {
    const ev = foldReport(
      emptyEvidence("a"),
      {
        alias: "charging_state",
        value: "charging",
        reportedAtMs: END - H,
        receivedAtMs: END + 90 * 60_000,
      },
      { startMs: START, endMs: END },
    );
    expect(ev.chargingSeen).toBe(true);
  });

  it("ignores what the car reported after the unplug (it may drive away)", () => {
    const ev = fold("a", [["at_home", false, END + 10 * 60_000]]);
    expect(ev.awaySeen).toBe(false);
  });

  it("counts everything after the start while the session is open", () => {
    const ev = fold("a", [["battery_level", 50, START + 30 * H]], { startMs: START, endMs: null });
    expect(ev.firstBattery).toBe(50);
  });

  it("uses the received time when the car has no report time", () => {
    const ev = foldReport(
      emptyEvidence("a"),
      { alias: "plugged", value: true, reportedAtMs: null, receivedAtMs: START + 1 },
      { startMs: START, endMs: END },
    );
    expect(ev.pluggedSeen).toBe(true);
  });
});
