import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../test-utils";
import { ElectricVehicleControl } from "./ElectricVehicleControl";
import type { EquipmentWithDetails } from "../../types";

// #1129 — a refused charge limit was said twice: the stepper's « Setpoint not
// applied » and, under it, the car's own reason. It is said once, the car's.
function vehicle(): EquipmentWithDetails {
  const data = {
    equipmentId: "ev-1",
    deviceDataId: "dd",
    deviceId: "dev-1",
    deviceName: "Car",
    lastUpdated: "2026-01-01T00:00:00Z",
    lastChanged: "2026-01-01T00:00:00Z",
    stale: false,
  };
  return {
    id: "ev-1",
    name: "Car",
    zoneId: "z-1",
    type: "electric_vehicle",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [
      { ...data, id: "d1", alias: "charge_limit", key: "charge_limit", type: "number", category: "ev_charge_limit", value: 80, unit: "%" },
    ] as EquipmentWithDetails["dataBindings"],
    orderBindings: [
      {
        id: "o1",
        equipmentId: "ev-1",
        deviceOrderId: "do1",
        alias: "charge_limit",
        deviceId: "dev-1",
        deviceName: "Car",
        key: "charge_limit",
        type: "number",
        category: "set_ev_charge_limit",
        min: 50,
        max: 100,
      },
    ] as EquipmentWithDetails["orderBindings"],
  };
}

describe("ElectricVehicleControl — charge limit failure", () => {
  it("writes the car's reason once, without the stepper's generic line", async () => {
    const onExecuteOrder = vi.fn().mockRejectedValue(new Error("Vehicle asleep"));
    render(<ElectricVehicleControl equipment={vehicle()} onExecuteOrder={onExecuteOrder} />);
    fireEvent.click(screen.getByRole("button", { name: "Raise the charge limit" }));
    await waitFor(() => expect(screen.getByText("Vehicle asleep")).toBeTruthy(), { timeout: 3000 });
    expect(onExecuteOrder).toHaveBeenCalledWith("charge_limit", 85);
    expect(screen.queryByText("Setpoint not applied")).toBeNull();
  });
});
