import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { EquipmentWidget } from "./EquipmentWidget";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";

// Component-test tier (issue #458). EquipmentWidget dispatches to a per-category
// sub-widget; these pin the highest-value path — a switch renders its ON/OFF
// state and its toggle fires onExecuteOrder with the right alias/value — plus a
// couple of guard rails (disabled hides the control, another category renders).

function makeEquipment(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Plug",
    zoneId: "z-1",
    type: "switch",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [
      {
        id: "db-1",
        equipmentId: "eq-1",
        deviceDataId: "dd-1",
        alias: "state",
        deviceId: "dev-1",
        deviceName: "Plug",
        key: "state",
        type: "boolean",
        category: "light_state",
        value: false,
        lastUpdated: "2026-01-01T00:00:00Z",
        lastChanged: "2026-01-01T00:00:00Z",
        stale: false,
      },
    ] as EquipmentWithDetails["dataBindings"],
    orderBindings: [
      {
        id: "ob-1",
        equipmentId: "eq-1",
        deviceOrderId: "do-1",
        alias: "state",
        deviceId: "dev-1",
        deviceName: "Plug",
        key: "state",
        type: "enum",
        enumValues: ["ON", "OFF"],
      },
    ] as EquipmentWithDetails["orderBindings"],
    ...over,
  };
}

function makeWidget(over: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id: "w-1",
    type: "equipment",
    equipmentId: "eq-1",
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("EquipmentWidget", () => {
  it("renders a switch as OFF and fires ON on toggle", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(
      <EquipmentWidget
        widget={makeWidget()}
        equipment={makeEquipment()}
        onExecuteOrder={onExecuteOrder}
      />,
    );

    expect(screen.getByText("OFF")).toBeTruthy();
    await userEvent.click(screen.getByRole("button"));
    expect(onExecuteOrder).toHaveBeenCalledWith("eq-1", "state", "ON");
  });

  it("renders a switch as ON and fires OFF on toggle", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    const eq = makeEquipment();
    eq.dataBindings[0].value = true;
    render(
      <EquipmentWidget widget={makeWidget()} equipment={eq} onExecuteOrder={onExecuteOrder} />,
    );

    expect(screen.getByText("ON")).toBeTruthy();
    await userEvent.click(screen.getByRole("button"));
    expect(onExecuteOrder).toHaveBeenCalledWith("eq-1", "state", "OFF");
  });

  it("hides the toggle when the equipment is disabled", () => {
    render(
      <EquipmentWidget
        widget={makeWidget()}
        equipment={makeEquipment({ enabled: false })}
        onExecuteOrder={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("dispatches another category (sensor) without crashing and shows its label", () => {
    const sensor = makeEquipment({
      id: "eq-2",
      name: "Temperature",
      type: "sensor",
      orderBindings: [],
      dataBindings: [
        {
          id: "db-2",
          equipmentId: "eq-2",
          deviceDataId: "dd-2",
          alias: "temperature",
          deviceId: "dev-2",
          deviceName: "Sensor",
          key: "temperature",
          type: "number",
          category: "temperature",
          value: 21.5,
          unit: "°C",
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ] as EquipmentWithDetails["dataBindings"],
    });
    render(
      <EquipmentWidget
        widget={makeWidget({ equipmentId: "eq-2", label: "Living room temp" })}
        equipment={sensor}
        onExecuteOrder={vi.fn()}
      />,
    );
    expect(screen.getByText("Living room temp")).toBeTruthy();
  });
});
