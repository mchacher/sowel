import { describe, it, expect } from "vitest";
import { buildLoadTimelines } from "./arbiter-timeline.js";
import type { ArbiterDecision } from "../shared/types.js";

// Window: 2026-08-14 12:00 → 13:00, 15-min steps → 4 quarters
// q0 12:00-12:15, q1 12:15-12:30, q2 12:30-12:45, q3 12:45-13:00
const START = Date.parse("2026-08-14T12:00:00.000Z");
const END = Date.parse("2026-08-14T13:00:00.000Z");
const iso = (min: number) => new Date(START + min * 60_000).toISOString();

function dec(
  min: number,
  kind: ArbiterDecision["kind"],
  equipmentId = "pac",
  running?: boolean,
): ArbiterDecision {
  return { atIso: iso(min), kind, equipmentId, equipmentName: "PAC", running };
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

  it("#604 — a reset closes a grant that would otherwise run to now", () => {
    // A grant opened before the window and was never revoked in the journal
    // (its live claim vanished on restart). The startup `reset` at 12:35 closes
    // the span there instead of painting green across the whole window.
    const [load] = buildLoadTimelines([dec(-30, "granted"), dec(35, "reset")], LOADS, START, END);
    expect(load.quarters).toEqual(["granted", "granted", "idle", "idle"]);
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

  it("maps a waiting decision to 'pending' until a grant ends it (#561)", () => {
    const [load] = buildLoadTimelines([dec(-5, "waiting"), dec(35, "granted")], LOADS, START, END);
    // pending from before the window through q0/q1; q2 (12:30-12:45) has the
    // 12:35 grant → granted, then granted.
    expect(load.quarters).toEqual(["pending", "pending", "granted", "granted"]);
  });

  it("reopens a 'pending' span after a revoke that re-journals waiting (#561)", () => {
    const [load] = buildLoadTimelines(
      [dec(-10, "granted"), dec(20, "revoked"), dec(20, "waiting")],
      LOADS,
      START,
      END,
    );
    // q0 granted; q1 (12:15-12:30) holds both the revoke and the re-wait →
    // flagged revoked, sustained becomes pending; q2/q3 pending.
    expect(load.quarters).toEqual(["granted", "revoked", "pending", "pending"]);
  });

  it("closes a 'pending' span when the claim is released without ever being granted (#584)", () => {
    const [load] = buildLoadTimelines([dec(-5, "waiting"), dec(35, "released")], LOADS, START, END);
    // pending from before the window; q2 (12:30-12:45) holds the 12:35 release
    // → idle. Without a `released` close the span would bleed to the edge.
    expect(load.quarters).toEqual(["pending", "pending", "idle", "idle"]);
  });

  it("reopens 'pending' when an unclaimed run ends over a still-pending claim (#584)", () => {
    const [load] = buildLoadTimelines(
      [
        dec(-5, "waiting"),
        dec(20, "unclaimed-run"),
        dec(35, "unclaimed-run-ended"),
        dec(35, "waiting"),
      ],
      LOADS,
      START,
      END,
    );
    // pending → q1 (12:20 unclaimed-run) unmanaged → q2 (12:35 end resets to
    // idle, then the re-journaled waiting reopens pending, last wins) → pending.
    expect(load.quarters).toEqual(["pending", "unmanaged", "pending", "pending"]);
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

  it("leaves a granted load granted when watts-divergence fires mid-grant (audit event, not a transition)", () => {
    const [load] = buildLoadTimelines(
      [dec(-10, "granted"), dec(35, "watts-divergence")],
      LOADS,
      START,
      END,
    );
    // The divergence is transparency only; the grant still holds → all granted.
    expect(load.quarters).toEqual(["granted", "granted", "granted", "granted"]);
  });

  it("stays idle after a revoke when the comfort load is switched off (comfort-off-after-revoke)", () => {
    const [load] = buildLoadTimelines(
      [dec(-10, "granted"), dec(20, "revoked"), dec(25, "comfort-off-after-revoke")],
      LOADS,
      START,
      END,
    );
    // q1 (12:15-12:30) contains the revoke → revoked; the off-confirmation must
    // NOT repaint the following quarters as "unmanaged" — the device is off.
    expect(load.quarters).toEqual(["granted", "revoked", "idle", "idle"]);
  });

  it("returns idle everywhere for a load with no decisions, and ignores other equipments", () => {
    const [load] = buildLoadTimelines([dec(20, "granted", "pompe")], LOADS, START, END);
    expect(load.quarters).toEqual(["idle", "idle", "idle", "idle"]);
  });
});

describe("buildLoadTimelines (issue #535) — an OFF load must not read 'unmanaged'", () => {
  it("maps a suspension that switched the load off (running=false) to idle", () => {
    // A manual OFF order suspends arbitration — but the load is stopped, so
    // the lane must not paint "on outside arbitration" for the whole TTL.
    const [load] = buildLoadTimelines([dec(5, "suspended", "pac", false)], LOADS, START, END);
    expect(load.quarters).toEqual(["idle", "idle", "idle", "idle"]);
  });

  it("keeps a suspension that left the load on (running=true) as unmanaged", () => {
    const [load] = buildLoadTimelines([dec(5, "suspended", "pac", true)], LOADS, START, END);
    expect(load.quarters).toEqual(["unmanaged", "unmanaged", "unmanaged", "unmanaged"]);
  });

  it("maps resumed on an OFF load to idle, not granted", () => {
    // Suspension left the load on, then the TTL expires while it is off:
    // control returns to the arbiter, nothing is granted yet.
    const [load] = buildLoadTimelines(
      [dec(-10, "suspended", "pac", true), dec(20, "resumed", "pac", false)],
      LOADS,
      START,
      END,
    );
    expect(load.quarters).toEqual(["unmanaged", "idle", "idle", "idle"]);
  });

  it("maps resumed on a still-running load to unmanaged (no grant yet)", () => {
    const [load] = buildLoadTimelines([dec(5, "resumed", "pac", true)], LOADS, START, END);
    expect(load.quarters).toEqual(["unmanaged", "unmanaged", "unmanaged", "unmanaged"]);
  });

  it("maps a legacy resumed entry (no running field) to idle", () => {
    // Pre-#535 rows have no `running`; the preceding suspend revoked any
    // grant, so idle is the only defensible reading (was: granted).
    const [load] = buildLoadTimelines([dec(5, "resumed")], LOADS, START, END);
    expect(load.quarters).toEqual(["idle", "idle", "idle", "idle"]);
  });
});
