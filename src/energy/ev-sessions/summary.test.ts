import { describe, expect, it } from "vitest";
import type { EvChargeSession } from "../../shared/types.js";
import { deriveEnergy, monthSummary, whPerBatteryPoint } from "./summary.js";

function session(over: Partial<EvChargeSession>): EvChargeSession {
  return {
    id: "s",
    chargerId: "c",
    chargerName: "Borne",
    startedAt: "2026-11-02T18:00:00.000Z",
    endedAt: "2026-11-03T06:00:00.000Z",
    graceUntil: "2026-11-03T08:00:00.000Z",
    energyWh: 0,
    gridHpWh: 0,
    gridHcWh: 0,
    solarWh: 0,
    costHpEur: null,
    costHcEur: null,
    costEur: null,
    vehicleId: "megane",
    vehicleName: "Megane",
    vehicleDeleted: false,
    attribution: "vehicle",
    attributionSource: "auto",
    attributionReason: "single-match",
    batteryStart: null,
    batteryEnd: null,
    candidates: [],
    updatedAt: "2026-11-03T08:00:00.000Z",
    ...over,
  };
}

describe("deriveEnergy", () => {
  it("scales the window estimates to the charger's meter", () => {
    const d = deriveEnergy({
      energyWh: 10_000,
      estCarWh: 9_000,
      estGridHpWh: 3_000,
      estGridHcWh: 0,
      estCostHpEur: 0.6,
      estCostHcEur: 0,
    });
    expect(d.gridHpWh).toBeCloseTo(3_333.33, 1);
    expect(d.solarWh).toBeCloseTo(6_666.67, 1);
    expect(d.costEur).toBeCloseTo(0.6667, 4);
  });

  it("uses the estimate as the energy for a charger without an energy meter", () => {
    const d = deriveEnergy({
      energyWh: 0,
      estCarWh: 5_000,
      estGridHpWh: 1_000,
      estGridHcWh: 1_000,
      estCostHpEur: null,
      estCostHcEur: null,
    });
    expect(d.energyWh).toBe(5_000);
    expect(d.solarWh).toBe(3_000);
    expect(d.costEur).toBeNull();
  });

  it("counts everything as grid when the meter moved without any estimate", () => {
    const d = deriveEnergy({
      energyWh: 200,
      estCarWh: 0,
      estGridHpWh: 0,
      estGridHcWh: 0,
      estCostHpEur: null,
      estCostHcEur: null,
    });
    expect(d.solarWh).toBe(0);
    expect(d.gridHpWh).toBe(200);
  });
});

describe("whPerBatteryPoint", () => {
  it("learns from rises of at least 10 points, ignoring the small ones", () => {
    expect(
      whPerBatteryPoint([
        { energyWh: 18_000, batteryStart: 40, batteryEnd: 70 },
        { energyWh: 12_000, batteryStart: 50, batteryEnd: 70 },
        { energyWh: 9_000, batteryStart: 60, batteryEnd: 65 },
        { energyWh: 5_000, batteryStart: null, batteryEnd: 80 },
      ]),
    ).toBe(600);
  });

  it("returns null before any qualifying session", () => {
    expect(whPerBatteryPoint([{ energyWh: 1_000, batteryStart: 60, batteryEnd: 62 }])).toBeNull();
  });

  it("uses at most the 10 most recent sessions", () => {
    const recent = Array.from({ length: 10 }, () => ({
      energyWh: 6_000,
      batteryStart: 10,
      batteryEnd: 20,
    }));
    const old = { energyWh: 100_000, batteryStart: 0, batteryEnd: 10 };
    expect(whPerBatteryPoint([...recent, old])).toBe(600);
  });
});

describe("monthSummary", () => {
  const sessions = [
    session({
      energyWh: 118_400,
      gridHcWh: 64_100,
      gridHpWh: 23_100,
      solarWh: 31_200,
      costHcEur: 8.22,
      costHpEur: 3.99,
      costEur: 12.21,
    }),
  ];

  it("gives the home price times the measured consumption (P11)", () => {
    const s = monthSummary({
      vehicleId: "megane",
      month: "2026-11",
      sessions,
      plugInHybrid: false,
      whPerPoint: 600,
      driving: { kmMeasured: 1_060, batteryDrop: 300 },
    });
    expect(s.costEur).toBeCloseTo(12.21, 6);
    expect(s.homePriceEurPerKwh).toBeCloseTo(0.1031, 4);
    expect(s.kWhPer100km).toBeCloseTo(16.98, 2);
    expect(s.eurPer100km).toBeCloseTo(1.75, 2);
    expect(s.eurPer100kmUnavailable).toBeNull();
  });

  it("computes the home price over priced sessions only", () => {
    const s = monthSummary({
      vehicleId: "megane",
      month: "2026-11",
      sessions: [...sessions, session({ energyWh: 50_000, costEur: null })],
      plugInHybrid: false,
      whPerPoint: 600,
      driving: { kmMeasured: 1_060, batteryDrop: 300 },
    });
    expect(s.homePriceEurPerKwh).toBeCloseTo(0.1031, 4);
  });

  it("is unchanged when half the km were driven on energy charged elsewhere", () => {
    const base = {
      vehicleId: "megane",
      month: "2026-11",
      sessions,
      plugInHybrid: false,
      whPerPoint: 600,
    };
    const homeOnly = monthSummary({ ...base, driving: { kmMeasured: 1_000, batteryDrop: 280 } });
    // Twice the km at the same consumption: the energy came from elsewhere.
    const mixed = monthSummary({ ...base, driving: { kmMeasured: 2_000, batteryDrop: 560 } });
    expect(mixed.eurPer100km).toBeCloseTo(homeOnly.eurPer100km!, 9);
  });

  it.each<[Partial<Parameters<typeof monthSummary>[0]>, string]>([
    [{ plugInHybrid: true }, "plug-in-hybrid"],
    [{ sessions: [] }, "no-home-session"],
    [{ whPerPoint: null }, "not-learned"],
    [{ driving: { kmMeasured: 40, batteryDrop: 8 } }, "too-few-km"],
  ])("hides the cost per 100 km with a reason (%o)", (over, reason) => {
    const s = monthSummary({
      vehicleId: "megane",
      month: "2026-11",
      sessions,
      plugInHybrid: false,
      whPerPoint: 600,
      driving: { kmMeasured: 1_060, batteryDrop: 300 },
      ...over,
    });
    expect(s.eurPer100km).toBeNull();
    expect(s.eurPer100kmUnavailable).toBe(reason);
  });
});
