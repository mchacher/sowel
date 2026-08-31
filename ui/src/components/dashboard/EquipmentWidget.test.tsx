import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, userEvent } from "../../test-utils";
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
  // A tile is the control, not just a frame around one: clicking anywhere on a
  // switch/light/valve card runs the same order as the button under the icon,
  // the way the mobile card already behaved.
  it("fires the toggle when the tile itself is clicked", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(
      <EquipmentWidget
        widget={makeWidget()}
        equipment={makeEquipment()}
        onExecuteOrder={onExecuteOrder}
      />,
    );

    await userEvent.click(screen.getByText("Plug"));
    expect(onExecuteOrder).toHaveBeenCalledWith("eq-1", "state", "ON");
  });

  it("fires the toggle once — not twice — when the button inside the tile is clicked", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(
      <EquipmentWidget
        widget={makeWidget()}
        equipment={makeEquipment()}
        onExecuteOrder={onExecuteOrder}
      />,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(onExecuteOrder).toHaveBeenCalledTimes(1);
  });

  it("leaves the tile inert in edit mode, where it is a drag and rename target", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    render(
      <EquipmentWidget
        widget={makeWidget()}
        equipment={makeEquipment()}
        onExecuteOrder={onExecuteOrder}
        editMode
      />,
    );

    await userEvent.click(screen.getByText("Plug"));
    expect(onExecuteOrder).not.toHaveBeenCalled();
  });

  // A brightness drag released off the slider track lands its click on the card
  // (their common ancestor). Without the pointerdown bookkeeping in WidgetCard,
  // adjusting a dimmable light would switch it off.
  it("does not toggle a dimmable light when a slider drag ends on the tile", async () => {
    const onExecuteOrder = vi.fn().mockResolvedValue(undefined);
    const dimmable = makeEquipment({
      id: "l-1",
      name: "Plafonnier",
      type: "light_dimmable",
      dataBindings: [
        {
          id: "db-l",
          equipmentId: "l-1",
          deviceDataId: "dd-l",
          alias: "state",
          deviceId: "dev-l",
          deviceName: "Lamp",
          key: "state",
          type: "boolean",
          category: "light_state",
          value: true,
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
        {
          id: "db-b",
          equipmentId: "l-1",
          deviceDataId: "dd-b",
          alias: "brightness",
          deviceId: "dev-l",
          deviceName: "Lamp",
          key: "brightness",
          type: "number",
          category: "light_brightness",
          value: 127,
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ] as EquipmentWithDetails["dataBindings"],
    });
    render(
      <EquipmentWidget
        widget={makeWidget({ equipmentId: "l-1" })}
        equipment={dimmable}
        onExecuteOrder={onExecuteOrder}
      />,
    );

    const slider = screen.getByRole("slider");
    const label = screen.getByText("Plafonnier");
    fireEvent.pointerDown(slider);
    fireEvent.click(label); // pointerup landed outside the track
    expect(onExecuteOrder).not.toHaveBeenCalled();

    // A plain click on the tile still toggles.
    await act(async () => {
      fireEvent.pointerDown(label);
      fireEvent.click(label);
    });
    expect(onExecuteOrder).toHaveBeenCalledWith("l-1", "state", "OFF");
  });
});


// ============================================================
// Issue #839 — a stale wattage must not be drawn as a live measurement.
// ============================================================

function agoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function powerBinding(over: Record<string, unknown> = {}) {
  return {
    id: "db-p",
    equipmentId: "eq-1",
    deviceDataId: "dd-p",
    alias: "power",
    deviceId: "dev-1",
    deviceName: "Clamp",
    key: "power",
    type: "number",
    category: "power",
    value: 560,
    unit: "W",
    lastUpdated: agoIso(5),
    lastChanged: agoIso(5),
    stale: false,
    ...over,
  };
}

function waterHeater(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
  return makeEquipment({
    name: "Chauffe-eau",
    type: "water_heater",
    dataBindings: [
      {
        id: "db-1",
        equipmentId: "eq-1",
        deviceDataId: "dd-1",
        alias: "state",
        deviceId: "dev-1",
        deviceName: "Relay",
        key: "state",
        type: "boolean",
        category: "light_state",
        value: true,
        lastUpdated: agoIso(5),
        lastChanged: agoIso(5),
        stale: false,
      },
      powerBinding(),
    ] as EquipmentWithDetails["dataBindings"],
    ...over,
  });
}

describe("EquipmentWidget — stale power readings (#839)", () => {
  it("prints a fresh water heater draw", () => {
    render(
      <EquipmentWidget
        widget={makeWidget()}
        equipment={waterHeater()}
        onExecuteOrder={vi.fn()}
      />,
    );

    expect(screen.getByText("560")).toBeTruthy();
  });

  it("withholds the water heater draw once past budget, and says how old it is", () => {
    // The #744 production sample: `0 W` displayed while the appliance drew
    // 560 W, because the clamp had gone quiet 944 s earlier. The engine's
    // `stale` flag is false here on purpose — a water_heater is not a
    // metering type — which is exactly why the tile has to judge for itself.
    const eq = waterHeater();
    eq.dataBindings[1] = powerBinding({
      value: 0,
      lastUpdated: agoIso(944),
      stale: false,
    }) as EquipmentWithDetails["dataBindings"][number];

    render(
      <EquipmentWidget widget={makeWidget()} equipment={eq} onExecuteOrder={vi.fn()} />,
    );

    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText("\u2014")).toBeTruthy();
    expect(screen.getByText(/15 min/)).toBeTruthy();
    // The tile keeps saying the heater is on: only the measurement is unknown.
    expect(screen.getByText("ON")).toBeTruthy();
  });

  it("keeps a 270 s reading from a slow-polling integration", () => {
    const eq = waterHeater();
    eq.dataBindings[1] = powerBinding({
      lastUpdated: agoIso(270),
    }) as EquipmentWithDetails["dataBindings"][number];

    render(
      <EquipmentWidget widget={makeWidget()} equipment={eq} onExecuteOrder={vi.fn()} />,
    );

    expect(screen.getByText("560")).toBeTruthy();
  });

  it("blanks a stale solar tile and says why, so it does not read as night", () => {
    const eq = makeEquipment({
      name: "Panneaux",
      type: "solar_panel",
      dataBindings: [
        powerBinding({ value: 1240, lastUpdated: agoIso(940) }),
      ] as EquipmentWithDetails["dataBindings"],
    });

    render(
      <EquipmentWidget widget={makeWidget()} equipment={eq} onExecuteOrder={vi.fn()} />,
    );

    expect(screen.queryByText(/1.24 kW/)).toBeNull();
    expect(screen.queryByText("Standby")).toBeNull();
    expect(screen.getByText(/reading outdated/)).toBeTruthy();
  });

  it("still shows standby for a panel that is simply not producing", () => {
    const eq = makeEquipment({
      name: "Panneaux",
      type: "solar_panel",
      dataBindings: [
        powerBinding({ value: 0, lastUpdated: agoIso(5) }),
      ] as EquipmentWithDetails["dataBindings"],
    });

    render(
      <EquipmentWidget widget={makeWidget()} equipment={eq} onExecuteOrder={vi.fn()} />,
    );

    expect(screen.getByText("Standby")).toBeTruthy();
    expect(screen.queryByText(/reading outdated/)).toBeNull();
  });
});
