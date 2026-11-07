import { describe, expect, it } from "vitest";
import type { EvChargeSession } from "../../../types";
import {
  energyLabel,
  energyShares,
  liveState,
  type LiveInputs,
  monthLabel,
  powerLabel,
  sessionChip,
  shiftMonth,
  toIso,
} from "./evSessionsDisplay";

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

describe("liveState (spec 192)", () => {
  const open = { endedAt: null };
  const live = (over: Partial<LiveInputs>): LiveInputs => ({
    chargerOn: true,
    vehicle: "connected",
    vehicleChangedAt: null,
    powerW: null,
    battery: 43,
    chargeLimit: 80,
    metered: false,
    ...over,
  });

  it("reads charging with the charger's power", () => {
    expect(liveState(open, live({ vehicle: "charging", powerW: 1300 }))).toEqual({
      kind: "charging",
      powerW: 1300,
    });
  });

  it("reads a switched-off charger as the pause reason, since the last change", () => {
    expect(
      liveState(open, live({ chargerOn: false, vehicleChangedAt: "2026-11-01 14:06:05Z" })),
    ).toEqual({
      kind: "paused",
      sinceIso: "2026-11-01T14:06:05.000Z",
      reason: "charger-off",
      battery: 43,
    });
  });

  it("reads the car at its charge limit", () => {
    expect(liveState(open, live({ battery: 80 }))).toMatchObject({
      reason: "charge-limit",
      battery: 80,
    });
  });

  it("waits for the car otherwise, or when its limit or the charger's state is unknown", () => {
    expect(liveState(open, live({}))).toMatchObject({ reason: "waiting-vehicle" });
    expect(liveState(open, live({ battery: 90, chargeLimit: null }))).toMatchObject({
      reason: "waiting-vehicle",
    });
    expect(liveState(open, live({ chargerOn: null }))).toMatchObject({
      reason: "waiting-vehicle",
    });
  });

  it("shows nothing between the unplug and the session's close", () => {
    expect(liveState(open, live({ vehicle: "disconnected" }))).toEqual({ kind: "unplugged" });
  });

  it("reads a metered charger by its power (spec 193)", () => {
    expect(
      liveState(open, live({ vehicle: null, chargerOn: null, powerW: 3000, metered: true })),
    ).toEqual({
      kind: "charging",
      powerW: 3000,
    });
    expect(
      liveState(open, live({ vehicle: null, chargerOn: null, powerW: 4, metered: true })),
    ).toEqual({
      kind: "paused",
      sinceIso: null,
      reason: null,
      battery: 43,
    });
  });

  it("reads an ended session as ended", () => {
    expect(liveState({ endedAt: "2026-11-01T15:06:00Z" }, live({}))).toEqual({ kind: "ended" });
  });

  it("reads charging without a power when the charger is unknown", () => {
    expect(liveState(open, null)).toEqual({ kind: "charging", powerW: null });
    expect(liveState(open, live({ vehicle: null, powerW: 1300 }))).toEqual({
      kind: "charging",
      powerW: null,
    });
  });

  it("parses SQLite and ISO timestamps", () => {
    expect(toIso("2026-11-01 14:06:05Z")).toBe("2026-11-01T14:06:05.000Z");
    expect(toIso("2026-11-01T14:06:05.000Z")).toBe("2026-11-01T14:06:05.000Z");
    expect(toIso(null)).toBeNull();
  });
});

describe("energyLabel / powerLabel (spec 196): the unit after U+202F, never a plain space", () => {
  it("formats a session's energy and power with their unit", () => {
    expect(energyLabel(14_312, "fr-FR")).toBe("14,3\u202FkWh");
    expect(energyLabel(700, "fr-FR")).toBe("0,7\u202FkWh");
    expect(powerLabel(3680, "fr-FR")).toBe("3,7\u202FkW");
    expect(energyLabel(14_312, "en-GB")).toBe("14.3\u00A0kWh");
  });
});
