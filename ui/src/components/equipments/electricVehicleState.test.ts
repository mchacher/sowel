import { describe, expect, it } from "vitest";
import { electricVehicleStateOf, evChargingStateKey } from "./electricVehicleState";
import type { EquipmentWithDetails } from "../../types";

const NOW = Date.parse("2026-10-03T17:00:00Z");

function car(
  data: { alias: string; category?: string; value?: unknown; lastUpdated?: string }[],
  orders: { alias: string; category?: string; type: string; min?: number; max?: number }[] = [],
): EquipmentWithDetails {
  return {
    type: "electric_vehicle",
    status: "online",
    dataBindings: data,
    orderBindings: orders,
  } as unknown as EquipmentWithDetails;
}

// A Renault-shaped car under its contract aliases.
const rafale = car(
  [
    { alias: "battery_level", category: "ev_battery_level", value: 64 },
    { alias: "range", category: "ev_range", value: 41 },
    { alias: "plugged", category: "ev_plugged", value: true },
    { alias: "charging_state", category: "ev_charging_state", value: "waiting" },
    { alias: "reported_at", category: "ev_reported_at", value: "2026-10-03T16:55:00Z" },
    { alias: "at_home", category: "ev_at_home", value: true },
    { alias: "mileage", category: "ev_mileage", value: 29413 },
    { alias: "charge_limit", category: "ev_charge_limit", value: 80 },
    { alias: "fuelAutonomy", category: "generic", value: 305 },
  ],
  [
    { alias: "wake", category: "ev_wake", type: "boolean" },
    { alias: "charge_start", category: "ev_charge_start", type: "boolean" },
    { alias: "refresh", category: "ev_refresh", type: "boolean" },
    { alias: "charge_limit", category: "set_ev_charge_limit", type: "number", min: 60, max: 100 },
  ],
);

describe("electricVehicleStateOf (spec 183)", () => {
  it("reads a full car", () => {
    const s = electricVehicleStateOf(rafale, NOW);
    expect(s).toMatchObject({
      batteryLevel: 64,
      rangeKm: 41,
      plugged: true,
      chargingState: "waiting",
      atHome: true,
      mileageKm: 29413,
      chargeLimit: 80,
      reportedAt: "2026-10-03T16:55:00Z",
      reportStale: false,
      wakeAlias: "wake",
      chargeStartAlias: "charge_start",
      refreshAlias: "refresh",
      chargeLimitOrder: { alias: "charge_limit", min: 60, max: 100 },
    });
  });

  it("marks a three-hour-old report as stale", () => {
    const old = car([
      { alias: "battery_level", category: "ev_battery_level", value: 8 },
      { alias: "reported_at", category: "ev_reported_at", value: "2026-10-03T14:00:00Z" },
    ]);
    expect(electricVehicleStateOf(old, NOW)).toMatchObject({ reportStale: true, batteryLevel: 8 });
  });

  it("falls back to the binding's own update time without reported_at", () => {
    const s = electricVehicleStateOf(
      car([
        {
          alias: "battery_level",
          category: "ev_battery_level",
          value: 50,
          lastUpdated: "2026-10-03T16:59:00Z",
        },
      ]),
      NOW,
    );
    expect(s.reportedAt).toBe("2026-10-03T16:59:00Z");
    expect(s.reportStale).toBe(false);
  });

  it("drops an unknown state and a null battery", () => {
    const s = electricVehicleStateOf(
      car([
        { alias: "battery_level", category: "ev_battery_level", value: null },
        { alias: "charging_state", category: "ev_charging_state", value: "0.3" },
      ]),
      NOW,
    );
    expect(s.batteryLevel).toBeNull();
    expect(s.chargingState).toBeNull();
    expect(s.wakeAlias).toBeNull();
    // Spec 184 AC3 — a car without the order shows no refresh button.
    expect(s.refreshAlias).toBeNull();
    expect(s.chargeLimitOrder).toBeNull();
  });

  it("bounds a charge-limit order without min/max to 50–100 %", () => {
    const s = electricVehicleStateOf(
      car([], [{ alias: "charge_limit", category: "set_ev_charge_limit", type: "number" }]),
      NOW,
    );
    expect(s.chargeLimitOrder).toEqual({ alias: "charge_limit", min: 50, max: 100 });
  });

  it("keys the charging states", () => {
    expect(evChargingStateKey("waiting")).toBe("equipments.electricVehicle.state.waiting");
  });
});
