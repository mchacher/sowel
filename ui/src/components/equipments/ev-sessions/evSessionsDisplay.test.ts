import { describe, expect, it } from "vitest";
import type { EvChargeSession } from "../../../types";
import { energyShares, monthLabel, sessionChip, shiftMonth } from "./evSessionsDisplay";

function session(over: Partial<EvChargeSession>): EvChargeSession {
  return {
    id: "s",
    chargerId: "c",
    chargerName: "Borne",
    startedAt: "2026-11-02T18:00:00.000Z",
    endedAt: null,
    graceUntil: null,
    energyWh: 0,
    gridHpWh: 0,
    gridHcWh: 0,
    solarWh: 0,
    costHpEur: null,
    costHcEur: null,
    costEur: null,
    vehicleId: null,
    vehicleName: null,
    vehicleDeleted: false,
    attribution: "pending",
    attributionSource: null,
    attributionReason: null,
    batteryStart: null,
    batteryEnd: null,
    candidates: [],
    updatedAt: "",
    ...over,
  };
}

describe("evSessionsDisplay (spec 191)", () => {
  it("shifts months across a year boundary", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("labels a month with a capital", () => {
    expect(monthLabel("2026-11", "fr-FR")).toBe("Novembre 2026");
  });

  it("splits a bar into off-peak, peak and solar", () => {
    expect(energyShares({ gridHcWh: 64_100, gridHpWh: 23_100, solarWh: 31_200 })).toEqual({
      hc: expect.closeTo(54.1, 1),
      hp: expect.closeTo(19.5, 1),
      solar: expect.closeTo(26.4, 1),
    });
    expect(energyShares({ gridHcWh: 0, gridHpWh: 0, solarWh: 0 })).toEqual({
      hc: 0,
      hp: 0,
      solar: 0,
    });
  });

  it("reads the attribution of a session", () => {
    expect(sessionChip(session({}))).toEqual({ kind: "identifying" });
    expect(sessionChip(session({ attribution: "unattributed" }))).toEqual({ kind: "todo" });
    expect(sessionChip(session({ attribution: "other" }))).toEqual({ kind: "other" });
    expect(
      sessionChip(session({ attribution: "vehicle", vehicleName: "Megane", vehicleDeleted: true })),
    ).toEqual({ kind: "vehicle", name: "Megane", deleted: true });
  });
});
