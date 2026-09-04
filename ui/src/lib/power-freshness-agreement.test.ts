import { describe, it, expect } from "vitest";
import type { DataBindingWithValue, EquipmentWithDetails } from "../types";
import { resolvePowerReading } from "./power-reading";
import { readSubmeterReading } from "../components/energy/submeter-helpers";
import { detectLiveStaleness } from "../components/energy/live-staleness";
import { BUDGET_FLOOR_MS } from "../../../src/shared/reading-freshness";

// Spec 175 FR3 — one reading, one verdict.
//
// This is the acceptance criterion the whole spec exists for, so it is asserted
// in one place rather than as four half-checks in four files. #883 measured the
// alternative: a meter three minutes into a healthy 300 s cycle was silent in
// the Live banner, "outdated" on its dashboard tile, and dropped from its zone
// total, all at the same instant, because each surface held a window of its own.
//
// Three of the four surfaces live here. The fourth, the zone power total, is
// backend and reads the same `freshnessBudgetMs` off the same binding
// (`src/zones/zone-aggregator.test.ts` covers it against the same two cadences).

const NOW = Date.parse("2026-09-03T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

/** 2.5 x 300 s, the budget a cloud poller earns. */
const POLLED_BUDGET_MS = 750_000;

function meter(budgetMs: number, ageSeconds: number): EquipmentWithDetails {
  const binding: DataBindingWithValue = {
    id: "b1",
    equipmentId: "e1",
    deviceDataId: "dd1",
    alias: "power",
    deviceId: "dev1",
    deviceName: "Meter",
    key: "power",
    type: "number",
    category: "power",
    value: 1200,
    unit: "W",
    lastUpdated: ago(ageSeconds),
    // Moving value: this test is about silence, not about a frozen source.
    lastChanged: ago(ageSeconds),
    stale: false,
    freshnessBudgetMs: budgetMs,
  };
  return {
    id: "e1",
    name: "Compteur",
    zoneId: "z1",
    type: "main_energy_meter",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [binding],
    orderBindings: [],
  } as EquipmentWithDetails;
}

/** What each surface says about the same equipment at the same instant. */
function verdicts(eq: EquipmentWithDetails): {
  tile: boolean;
  breakdown: boolean;
  banner: boolean;
} {
  const staleness = detectLiveStaleness([eq], [], NOW);
  return {
    tile: resolvePowerReading(eq, eq.dataBindings[0], NOW).verdict === "current",
    breakdown: readSubmeterReading(eq, NOW).power !== null,
    banner: staleness.length === 0,
  };
}

describe("power freshness agreement across surfaces (spec 175 FR3)", () => {
  it("agrees that a 300 s source three minutes quiet is live", () => {
    const v = verdicts(meter(POLLED_BUDGET_MS, 180));

    expect(v).toEqual({ tile: true, breakdown: true, banner: true });
  });

  it("agrees that a 1 Hz source three minutes quiet is not", () => {
    const v = verdicts(meter(BUDGET_FLOOR_MS, 180));

    expect(v).toEqual({ tile: false, breakdown: false, banner: false });
  });

  it("agrees at the edge of the budget, on both sides", () => {
    expect(verdicts(meter(POLLED_BUDGET_MS, 749))).toEqual({
      tile: true,
      breakdown: true,
      banner: true,
    });
    expect(verdicts(meter(POLLED_BUDGET_MS, 751))).toEqual({
      tile: false,
      breakdown: false,
      banner: false,
    });
  });
});
