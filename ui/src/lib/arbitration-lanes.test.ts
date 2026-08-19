import { describe, it, expect } from "vitest";
import { buildLanes } from "./arbitration-lanes";
import type { ArbiterPublicState, ArbiterDecision } from "../types";

// The journal is newest-first (as the API returns it). Build "today" ISO
// timestamps at given local HH:MM so isToday() keeps them.
function at(h: number, m: number): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function state(journal: ArbiterDecision[], pending: string[] = []): ArbiterPublicState {
  return {
    enabled: true,
    state: "active",
    availableSurplusW: 0,
    productionDetected: true,
    grants: [],
    pending: pending.map((equipmentId) => ({
      equipmentId,
      equipmentName: equipmentId,
      instanceId: "i",
      watts: 600,
      needW: 700,
      toleratedImportW: 0,
      reasonWaiting: "insufficient-surplus:0",
    })),
    suspensions: [],
    idle: [],
    priority: [],
    journal, // newest-first
    surplusSeries: [],
  };
}

const profiled = [{ id: "pump", name: "Pompe" }];

describe("buildLanes", () => {
  it("pairs a grant with its later revoke into one segment + a marker", () => {
    const journal: ArbiterDecision[] = [
      { atIso: at(15, 0), kind: "revoked", equipmentId: "pump", reason: "surplus-deficit" },
      { atIso: at(13, 0), kind: "granted", equipmentId: "pump" },
    ];
    const [lane] = buildLanes(state(journal), profiled, 16 * 60);
    expect(lane.segments).toEqual([
      { startMin: 13 * 60, endMin: 15 * 60, kind: "granted" },
    ]);
    expect(lane.markers).toEqual([{ min: 15 * 60, kind: "revoked", label: "surplus-deficit" }]);
    expect(lane.pendingFromMin).toBeNull();
  });

  it("leaves an open grant running to now, and says it is still open", () => {
    const journal: ArbiterDecision[] = [{ atIso: at(14, 0), kind: "granted", equipmentId: "pump" }];
    const [lane] = buildLanes(state(journal), profiled, 15 * 60);
    expect(lane.segments).toEqual([
      { startMin: 14 * 60, endMin: 15 * 60, kind: "granted", open: true },
    ]);
  });

  it("draws a run outside arbitration as a span, not a start marker", () => {
    // How long a load held power without a grant is the whole question; a
    // lone start says nothing about it.
    const journal: ArbiterDecision[] = [
      { atIso: at(4, 35), kind: "unclaimed-run-ended", equipmentId: "pump" },
      { atIso: at(2, 4), kind: "unclaimed-run", equipmentId: "pump", reason: "off-peak plan" },
    ];
    const [lane] = buildLanes(state(journal), profiled, 16 * 60);
    expect(lane.segments).toEqual([
      { startMin: 2 * 60 + 4, endMin: 4 * 60 + 35, kind: "unclaimed" },
    ]);
    expect(lane.markers).toEqual([]);
  });

  it("runs an unfinished unclaimed span up to now", () => {
    // Also the shape a core older than `unclaimed-run-ended` produces: drawn
    // to now, which is the honest reading of a start with no recorded end.
    const journal: ArbiterDecision[] = [
      { atIso: at(22, 0), kind: "unclaimed-run", equipmentId: "pump" },
    ];
    const [lane] = buildLanes(state(journal), profiled, 23 * 60 + 30);
    expect(lane.segments).toEqual([
      { startMin: 22 * 60, endMin: 23 * 60 + 30, kind: "unclaimed", open: true },
    ]);
  });

  it("renders a manual suspension as a manual segment", () => {
    const journal: ArbiterDecision[] = [
      { atIso: at(10, 0), kind: "resumed", equipmentId: "pump" },
      { atIso: at(8, 0), kind: "suspended", equipmentId: "pump", reason: "user-order" },
    ];
    const [lane] = buildLanes(state(journal), profiled, 12 * 60);
    expect(lane.segments).toEqual([{ startMin: 8 * 60, endMin: 10 * 60, kind: "manual" }]);
  });

  it("shows a pending tail when the claim is waiting", () => {
    const [lane] = buildLanes(state([], ["pump"]), profiled, 15 * 60);
    expect(lane.pendingFromMin).not.toBeNull();
  });

  it("degrades gracefully when an opening entry was evicted from the bounded journal", () => {
    // Only a revoke survived (its grant fell off the 200-entry ring): no
    // segment, just the marker — never a crash or a negative-width span.
    const journal: ArbiterDecision[] = [
      { atIso: at(15, 0), kind: "revoked", equipmentId: "pump", reason: "surplus-deficit" },
    ];
    const [lane] = buildLanes(state(journal), profiled, 16 * 60);
    expect(lane.segments).toEqual([]);
    expect(lane.markers).toHaveLength(1);
  });
});
