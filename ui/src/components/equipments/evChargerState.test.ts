import { describe, expect, it } from "vitest";
import { clampChargeCurrent, evChargerStateOf, evVehicleKey } from "./evChargerState";
import type { EquipmentWithDetails } from "../../types";

interface D {
  alias: string;
  category?: string;
  value?: unknown;
}
interface O {
  alias: string;
  category?: string;
  type: string;
  min?: number;
  max?: number;
}

function charger(data: D[], orders: O[] = []): EquipmentWithDetails {
  const now = new Date().toISOString();
  return {
    type: "ev_charger",
    status: "online",
    dataBindings: data.map((d) => ({ lastUpdated: now, ...d })),
    orderBindings: orders,
  } as unknown as EquipmentWithDetails;
}

// The tuya plugin v0.2.0 shape: contract categories under its own keys.
const full = charger(
  [
    { alias: "state", category: "appliance_state", value: true },
    { alias: "vehicle", category: "ev_vehicle_state", value: "charging" },
    { alias: "power", category: "power", value: 1680 },
    { alias: "session_energy", category: "ev_session_energy", value: 5.2 },
    { alias: "charge_current", category: "ev_charge_current", value: 8 },
    { alias: "current", category: "current", value: 7.4 },
    { alias: "voltage", category: "voltage", value: 227 },
    { alias: "status", category: "generic", value: "charging" },
  ],
  [
    { alias: "state", category: "toggle_power", type: "boolean" },
    { alias: "charge_current", category: "set_ev_charge_current", type: "number", min: 6, max: 16 },
  ],
);

describe("evChargerStateOf (spec 182)", () => {
  it("reads a full charger while charging", () => {
    const s = evChargerStateOf(full);
    expect(s.on).toBe(true);
    expect(s.canToggle).toBe(true);
    expect(s.vehicle).toBe("charging");
    expect(s.power.watts).toBe(1680);
    expect(s.sessionEnergyKwh).toBe(5.2);
    expect(s.chargeCurrentA).toBe(8);
    expect(s.chargeCurrentOrder).toEqual({ alias: "charge_current", min: 6, max: 16 });
    expect(s.measuredCurrentA).toBe(7.4);
    expect(s.voltageV).toBe(227);
  });

  it("finds points by category whatever their alias", () => {
    const s = evChargerStateOf(
      charger(
        [
          { alias: "etat_borne", category: "appliance_state", value: false },
          { alias: "voiture", category: "ev_vehicle_state", value: "connected" },
        ],
        [{ alias: "courant", category: "set_ev_charge_current", type: "number", min: 6, max: 32 }],
      ),
    );
    expect(s.on).toBe(false);
    expect(s.vehicle).toBe("connected");
    expect(s.chargeCurrentOrder?.alias).toBe("courant");
  });

  it("reads a relay modelled as a charger: on/off only", () => {
    const s = evChargerStateOf(
      charger(
        [{ alias: "state", category: "light_state", value: "ON" }],
        [{ alias: "state", category: "light_toggle", type: "boolean" }],
      ),
    );
    expect(s.on).toBe(true);
    expect(s.canToggle).toBe(true);
    expect(s.vehicle).toBeNull();
    expect(s.power.watts).toBeNull();
    expect(s.chargeCurrentOrder).toBeNull();
    expect(s.sessionEnergyKwh).toBeNull();
  });

  it("drops a vehicle value outside the enum", () => {
    const s = evChargerStateOf(
      charger([{ alias: "vehicle", category: "ev_vehicle_state", value: "plugged" }]),
    );
    expect(s.vehicle).toBeNull();
  });

  it("bounds a current order without min/max to 6–32 A", () => {
    const s = evChargerStateOf(
      charger([], [{ alias: "charge_current", category: "set_ev_charge_current", type: "number" }]),
    );
    expect(s.chargeCurrentOrder).toEqual({ alias: "charge_current", min: 6, max: 32 });
  });

  it("ignores the v0.1.0 generic points: no vehicle, no stepper", () => {
    const s = evChargerStateOf(
      charger(
        [
          { alias: "vehicleState", category: "generic", value: "charging" },
          { alias: "currentSetpoint", category: "generic", value: 8 },
        ],
        [{ alias: "currentOrder", type: "number", min: 6, max: 16 }],
      ),
    );
    expect(s.vehicle).toBeNull();
    expect(s.chargeCurrentA).toBeNull();
    expect(s.chargeCurrentOrder).toBeNull();
  });

  it("reads nothing from an empty charger", () => {
    const s = evChargerStateOf(charger([]));
    expect(s.on).toBeNull();
    expect(s.canToggle).toBe(false);
    expect(s.vehicle).toBeNull();
  });
});

describe("charger helpers", () => {
  it("keys the vehicle states", () => {
    expect(evVehicleKey("connected")).toBe("equipments.evCharger.vehicle.connected");
  });

  it("clamps and rounds a requested current into the order's range", () => {
    const order = { alias: "charge_current", min: 6, max: 16 };
    expect(clampChargeCurrent(4, order)).toBe(6);
    expect(clampChargeCurrent(10.6, order)).toBe(11);
    expect(clampChargeCurrent(20, order)).toBe(16);
  });
});
