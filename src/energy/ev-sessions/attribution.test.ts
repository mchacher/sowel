import { describe, expect, it } from "vitest";
import {
  attribute,
  batteryRise,
  emptyEvidence,
  matches,
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
  session: Parameters<typeof foldReport>[2] = { startMs: START, endMs: END },
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

  it("does not hold a car's own unplug report against it", () => {
    const rafale = fold("rafale", [
      ["charging_state", "charging", START + H],
      ["plugged", false, END - 30_000],
    ]);
    expect(attribute([rafale, emptyEvidence("megane")], ["rafale", "megane"])).toMatchObject({
      vehicleId: "rafale",
    });
    expect(attribute([fold("solo", [["plugged", false, END]])], ["solo"]).state).toBe("vehicle");
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

describe("attribute with a usual vehicle (spec 193)", () => {
  const charging = (id: string) => fold(id, [["charging_state", "charging", START + H]]);

  it("breaks a tie for the usual vehicle", () => {
    expect(attribute([charging("a"), charging("b")], ["a", "b"], { usualVehicleId: "b" })).toEqual({
      state: "vehicle",
      vehicleId: "b",
      reason: "usual-vehicle",
    });
  });

  it("leaves the tie when the usual vehicle is not among the matches", () => {
    expect(
      attribute([charging("a"), charging("b")], ["a", "b", "c"], { usualVehicleId: "c" }),
    ).toEqual({
      state: "unattributed",
      reason: "several-matches",
    });
  });

  it("never gives a session no car matches to the usual vehicle", () => {
    expect(attribute([emptyEvidence("a")], ["a", "b"], { usualVehicleId: "b" })).toEqual({
      state: "unattributed",
      reason: "no-match",
    });
  });

  it("drops the cars charging elsewhere, without making the rest the only vehicle", () => {
    const excluded = new Set(["b"]);
    expect(attribute([charging("a"), charging("b")], ["a", "b"], { excluded })).toMatchObject({
      vehicleId: "a",
      reason: "single-match",
    });
    expect(attribute([emptyEvidence("a")], ["a", "b"], { excluded })).toMatchObject({
      reason: "no-match",
    });
    expect(attribute([], ["b"], { excluded })).toMatchObject({ reason: "no-match" });
  });

  it("lets a single match win over the usual vehicle", () => {
    expect(attribute([charging("a")], ["a", "b"], { usualVehicleId: "b" })).toMatchObject({
      vehicleId: "a",
    });
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

  it("returns the same evidence when a report adds nothing", () => {
    const ev = fold("a", [["charging_state", "charging", START + H]]);
    const again = foldReport(
      ev,
      { alias: "charging_state", value: "charging", reportedAtMs: START + 2 * H, receivedAtMs: 0 },
      { startMs: START, endMs: END },
    );
    expect(again).toBe(ev);
  });

  it("counts a charging or plugged report from the slack the tracker allows (#1105)", () => {
    const session = { startMs: START, endMs: END, positiveFromMs: START - 15 * 60_000 };
    const ev = fold(
      "a",
      [
        ["charging_state", "charging", START - 3 * 60_000],
        ["plugged", true, START - 10 * 60_000],
      ],
      session,
    );
    expect(ev).toMatchObject({ chargingSeen: true, pluggedSeen: true });
    expect(
      fold("a", [["charging_state", "charging", START - 20 * 60_000]], session).chargingSeen,
    ).toBe(false);
    // Without a slack from the tracker, the start is strict.
    expect(fold("a", [["charging_state", "charging", START - 60_000]]).chargingSeen).toBe(false);
  });

  it("keeps the strict start for being away and the battery (#1105)", () => {
    const ev = fold(
      "a",
      [
        ["at_home", false, START - 5 * 60_000],
        ["battery_level", 30, START - 5 * 60_000],
      ],
      { startMs: START, endMs: END, positiveFromMs: START - 15 * 60_000 },
    );
    expect(ev).toMatchObject({ awaySeen: false, firstBattery: null });
  });

  it("takes the latest level just before the start as the starting level (audit A4)", () => {
    const session = { startMs: START, endMs: END, positiveFromMs: START - 15 * 60_000 };
    const ev = fold(
      "a",
      [
        ["battery_level", 38, START - 10 * 60_000],
        ["battery_level", 40, START - 60_000],
        ["battery_level", 55, START + H],
      ],
      session,
    );
    expect(ev).toMatchObject({ baseBattery: 40, firstBattery: 55, maxBattery: 55 });
    expect(batteryRise(ev)).toBe(15);
  });

  it("raises the highest level from a report just after the end, never alone (audit A4)", () => {
    const after = END + 5 * 60_000;
    const ev = fold("a", [
      ["battery_level", 40, START + H],
      ["battery_level", 66, after],
    ]);
    expect(ev.maxBattery).toBe(66);
    expect(fold("a", [["battery_level", 66, after]]).maxBattery).toBeNull();
    expect(
      fold("a", [
        ["battery_level", 40, START + H],
        ["battery_level", 90, END + H],
      ]).maxBattery,
    ).toBe(40);
  });

  it("needs a car away at the opening to be seen home before it matches (audit A5)", () => {
    const away = { ...fold("a", [["charging_state", "charging", START + H]]), awayAtStart: true };
    expect(matches(away)).toBe(false);
    const home = foldReport(
      away,
      { alias: "at_home", value: true, reportedAtMs: null, receivedAtMs: START + 2 * H },
      { startMs: START, endMs: END },
    );
    expect(matches(home)).toBe(true);
  });
});
