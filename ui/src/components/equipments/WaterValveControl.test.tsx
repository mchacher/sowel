import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../test-utils";
import { WaterValveControl } from "./WaterValveControl";
import type { EquipmentWithDetails } from "../../types";

// Issue #1310 — the core accepts the timed watering composite only on the bound
// order's own key, because z2m publishes the object as the whole payload. A
// valve on a multi-channel relay is keyed `state_l1`, not `state`.
function valve(key: string): EquipmentWithDetails {
  return {
    id: "v-1",
    name: "Vanne",
    zoneId: "z-1",
    type: "water_valve",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [] as EquipmentWithDetails["dataBindings"],
    orderBindings: [
      {
        id: "o1",
        equipmentId: "v-1",
        deviceOrderId: "do1",
        alias: "state",
        deviceId: "dev-1",
        deviceName: "Relay",
        key,
        type: "enum",
        category: "valve_toggle",
        enumValues: ["ON", "OFF"],
      },
    ] as EquipmentWithDetails["orderBindings"],
  };
}

describe("WaterValveControl — timed watering", () => {
  it.each(["state", "state_l1"])("keys the composite by the bound order key (%s)", async (key) => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(<WaterValveControl equipment={valve(key)} onExecuteOrder={onExecuteOrder} />);
    fireEvent.click(screen.getByRole("button", { name: /Water for 10 min/ }));
    await waitFor(() => expect(onExecuteOrder).toHaveBeenCalledOnce());
    expect(onExecuteOrder).toHaveBeenCalledWith("state", { [key]: "ON", on_time: 600 });
  });
});
