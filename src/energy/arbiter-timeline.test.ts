import { describe, it, expect } from "vitest";
import { buildLoadTimelines } from "./arbiter-timeline.js";
import type { ArbiterDecision } from "../shared/types.js";

// Window: 2026-08-14 12:00 → 13:00, 15-min steps → 4 quarters
// q0 12:00-12:15, q1 12:15-12:30, q2 12:30-12:45, q3 12:45-13:00
const START = Date.parse("2026-08-14T12:00:00.000Z");
const END = Date.parse("2026-08-14T13:00:00.000Z");
const iso = (min: number) => new Date(START + min * 60_000).toISOString();

function dec(min: number, kind: ArbiterDecision["kind"], equipmentId = "pac"): ArbiterDecision {
  return { atIso: iso(min), kind, equipmentId, equipmentName: "PAC" };
}
const LOADS = [{ equipmentId: "pac", name: "PAC" }];

describe("buildLoadTimelines (spec 148)", () => {
  it("carries a grant that started before the window across all quarters", () => {
    const [load] = buildLoadTimelines([dec(-30, "granted")], LOADS, START, END);
    expect(load.quarters).toEqual(["granted", "granted", "granted", "granted"]);
  });

  it("goes idle before a grant and granted after", () => {
    const [load] = buildLoadTimelines([dec(20, "granted")], LOADS, START, END);
    // q0 idle, q1 (12:15-12:30 contains 12:20 grant) granted, then granted
    expect(load.quarters).toEqual(["idle", "granted", "granted", "granted"]);
  });

  it("flags the quarter that contains a revoke, then idle after", () => {
    const [load] = buildLoadTimelines([dec(-10, "granted"), dec(35, "revoked")], LOADS, START, END);
    // granted until q2 (12:30-12:45) where the 12:35 revoke lands → revoked, then idle
    expect(load.quarters).toEqual(["granted", "granted", "revoked", "idle"]);
  });

  it("re-grant within a revoke quarter still flags revoked (notable event)", () => {
    const [load] = buildLoadTimelines(
      [dec(-10, "granted"), dec(32, "revoked"), dec(40, "granted")],
      LOADS,
      START,
      END,
    );
    // q2 has both revoke and re-grant → revoked; q3 granted
    expect(load.quarters).toEqual(["granted", "granted", "revoked", "granted"]);
  });

  it("maps suspended and unclaimed-run to 'unmanaged'", () => {
    const [a] = buildLoadTimelines([dec(5, "suspended")], LOADS, START, END);
    expect(a.quarters).toEqual(["unmanaged", "unmanaged", "unmanaged", "unmanaged"]);
    const [b] = buildLoadTimelines(
      [dec(5, "unclaimed-run"), dec(50, "unclaimed-run-ended")],
      LOADS,
      START,
      END,
    );
    expect(b.quarters).toEqual(["unmanaged", "unmanaged", "unmanaged", "idle"]);
  });

  it("returns idle everywhere for a load with no decisions, and ignores other equipments", () => {
    const [load] = buildLoadTimelines([dec(20, "granted", "pompe")], LOADS, START, END);
    expect(load.quarters).toEqual(["idle", "idle", "idle", "idle"]);
  });
});
