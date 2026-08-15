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

  // Spec 139 — two widgets on homonym equipments are told apart by their zone,
  // on a second line so the name itself never gets truncated away.
  it("shows the zone under the name, and a manual label replaces both", () => {
    render(
      <EquipmentWidget
        widget={makeWidget()}
        equipment={makeEquipment()}
        equipmentZone="Bureau"
        onExecuteOrder={vi.fn()}
      />,
    );
    expect(screen.getByText("Plug")).toBeTruthy();
    expect(screen.getByText("Bureau")).toBeTruthy();

    render(
      <EquipmentWidget
        widget={makeWidget({ label: "Imprimante 3D" })}
        equipment={makeEquipment()}
        equipmentZone="Bureau"
        onExecuteOrder={vi.fn()}
      />,
    );
    expect(screen.getByText("Imprimante 3D")).toBeTruthy();
    expect(screen.queryAllByText("Bureau")).toHaveLength(1); // only the first render's
  });

  // Issue #324 — a media_player used to fall through to the generic widget on
  // desktop. It now renders the source and a power toggle.
  it("renders a media_player with its source and fires the power toggle", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    const tv = makeEquipment({
      id: "tv-1",
      name: "TV",
      type: "media_player",
      dataBindings: [
        {
          id: "db-p",
          equipmentId: "tv-1",
          deviceDataId: "dd-p",
          alias: "power",
          deviceId: "dev-tv",
          deviceName: "TV",
          key: "power",
          type: "boolean",
          category: "light_state",
          value: true,
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
        {
          id: "db-s",
          equipmentId: "tv-1",
          deviceDataId: "dd-s",
          alias: "input_source",
          deviceId: "dev-tv",
          deviceName: "TV",
          key: "input_source",
          type: "string",
          category: "generic",
          value: "HDMI1",
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ] as EquipmentWithDetails["dataBindings"],
      orderBindings: [
        {
          id: "ob-p",
          equipmentId: "tv-1",
          deviceOrderId: "do-p",
          alias: "power",
          deviceId: "dev-tv",
          deviceName: "TV",
          key: "power",
          type: "boolean",
        },
      ] as EquipmentWithDetails["orderBindings"],
    });
    render(
      <EquipmentWidget
        widget={makeWidget({ equipmentId: "tv-1" })}
        equipment={tv}
        onExecuteOrder={onExecuteOrder}
      />,
    );

    expect(screen.getByText("HDMI1")).toBeTruthy();
    await userEvent.click(screen.getByRole("button"));
    expect(onExecuteOrder).toHaveBeenCalledWith("tv-1", "power", false);
  });

  // Spec 149 — the pool pump descriptor exposes the daily runtime as a
  // secondary state line (was desktop-only before the resolver migration).
  it("renders a pool_pump with its ON state and daily runtime", () => {
    const pump = makeEquipment({
      id: "pp-1",
      name: "Pool pump",
      type: "pool_pump",
      computedData: [
        { alias: "runtime_daily", value: 5400, lastUpdated: "2026-01-01T00:00:00Z" },
      ],
    });
    pump.dataBindings[0].value = true;
    render(
      <EquipmentWidget
        widget={makeWidget({ equipmentId: "pp-1" })}
        equipment={pump}
        onExecuteOrder={vi.fn()}
      />,
    );
    expect(screen.getByText("ON")).toBeTruthy();
    expect(screen.getByText("1h 30m")).toBeTruthy();
  });

  // Issue #325 — a multi-action gate exposed NO way to act on desktop (the
  // mobile detail sheet had one button per enum action, the desktop card none).
  it("renders one button per action on a multi-action gate and fires the enum value", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    const gate = makeEquipment({
      id: "g-1",
      name: "Portail",
      type: "gate",
      dataBindings: [
        {
          id: "db-g",
          equipmentId: "g-1",
          deviceDataId: "dd-g",
          alias: "state",
          deviceId: "dev-g",
          deviceName: "Gate",
          key: "state",
          type: "enum",
          category: "gate_state",
          value: "closed",
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ] as EquipmentWithDetails["dataBindings"],
      orderBindings: [
        {
          id: "ob-g",
          equipmentId: "g-1",
          deviceOrderId: "do-g",
          alias: "command",
          deviceId: "dev-g",
          deviceName: "Gate",
          key: "command",
          type: "enum",
          category: "gate_trigger",
          enumValues: ["OPEN", "CLOSE", "PEDESTRIAN"],
        },
      ] as EquipmentWithDetails["orderBindings"],
    });
    render(
      <EquipmentWidget
        widget={makeWidget({ equipmentId: "g-1" })}
        equipment={gate}
        onExecuteOrder={onExecuteOrder}
      />,
    );

    expect(screen.getByText("OPEN")).toBeTruthy();
    expect(screen.getByText("CLOSE")).toBeTruthy();
    await userEvent.click(screen.getByText("PEDESTRIAN"));
    expect(onExecuteOrder).toHaveBeenCalledWith("g-1", "command", "PEDESTRIAN");
  });

  it("keeps the single-action gate as a tap-the-card action (no button row)", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    const gate = makeEquipment({
      id: "g-2",
      name: "Garage",
      type: "gate",
      dataBindings: [
        {
          id: "db-g2",
          equipmentId: "g-2",
          deviceDataId: "dd-g2",
          alias: "state",
          deviceId: "dev-g2",
          deviceName: "Gate",
          key: "state",
          type: "enum",
          category: "gate_state",
          value: "closed",
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ] as EquipmentWithDetails["dataBindings"],
      orderBindings: [
        {
          id: "ob-g2",
          equipmentId: "g-2",
          deviceOrderId: "do-g2",
          alias: "command",
          deviceId: "dev-g2",
          deviceName: "Gate",
          key: "command",
          type: "enum",
          category: "gate_trigger",
          enumValues: ["TRIGGER"],
        },
      ] as EquipmentWithDetails["orderBindings"],
    });
    render(
      <EquipmentWidget
        widget={makeWidget({ equipmentId: "g-2" })}
        equipment={gate}
        onExecuteOrder={onExecuteOrder}
      />,
    );

    // No per-enum button row for a single action…
    expect(screen.queryByText("TRIGGER")).toBeNull();
    // …the whole card is the action.
    await userEvent.click(screen.getByText("Garage"));
    expect(onExecuteOrder).toHaveBeenCalledWith("g-2", "command", null);
  });
});
