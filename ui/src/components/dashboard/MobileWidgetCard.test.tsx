import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { MobileWidgetCard } from "./MobileWidgetCard";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";

// Issue #323 — an energy_meter used to render a blank mobile card (label only)
// because useMobileState had no isEnergyMeter branch. It now shows today's
// consumption and the current power.

function makeEnergyMeter(): EquipmentWithDetails {
  return {
    id: "em-1",
    name: "Main meter",
    zoneId: "z-1",
    type: "energy_meter",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [
      {
        id: "db-d",
        equipmentId: "em-1",
        deviceDataId: "dd-d",
        alias: "demand_5min",
        deviceId: "dev-1",
        deviceName: "Meter",
        key: "demand_5min",
        type: "number",
        category: "power",
        value: 800,
        lastUpdated: "2026-01-01T00:00:00Z",
        lastChanged: "2026-01-01T00:00:00Z",
        stale: false,
      },
    ] as EquipmentWithDetails["dataBindings"],
    orderBindings: [],
    computedData: [{ alias: "energy_day", value: 1500, lastUpdated: "2026-01-01T00:00:00Z" }],
  };
}

const widget: DashboardWidget = {
  id: "w-1",
  type: "equipment",
  equipmentId: "em-1",
  displayOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("MobileWidgetCard", () => {
  it("renders an energy_meter's today value and current power (issue #323)", () => {
    render(<MobileWidgetCard widget={widget} equipment={makeEnergyMeter()} />);
    // energy_day 1500 Wh -> 1.5 kWh, demand_5min 800 -> 800 W, joined by " · ".
    expect(screen.getByText(/1\.5 kWh/)).toBeTruthy();
    expect(screen.getByText(/800 W/)).toBeTruthy();
  });

  it("still shows the equipment label", () => {
    render(<MobileWidgetCard widget={widget} equipment={makeEnergyMeter()} />);
    expect(screen.getByText("Main meter")).toBeTruthy();
  });

  // Spec 149 — switch/pool_pump/media_player state comes from the shared
  // presentation descriptor, the same source the desktop widget renders.
  it("renders a switch ON state from the presentation descriptor", () => {
    const plug = makeEquipment({
      id: "sw-1",
      name: "Plug",
      type: "switch",
      dataBindings: [
        stateDataBinding({ equipmentId: "sw-1", value: true }),
      ] as EquipmentWithDetails["dataBindings"],
    });
    render(
      <MobileWidgetCard widget={{ ...widget, equipmentId: "sw-1" }} equipment={plug} />,
    );
    expect(screen.getByText("ON")).toBeTruthy();
  });

  // Issue #325 divergence 1 — the daily runtime was desktop-only; the mobile
  // card now shows it as a secondary line.
  it("renders a pool_pump's runtime line next to its ON/OFF state", () => {
    const pump = makeEquipment({
      id: "pp-1",
      name: "Pool pump",
      type: "pool_pump",
      dataBindings: [
        stateDataBinding({ equipmentId: "pp-1", value: true }),
      ] as EquipmentWithDetails["dataBindings"],
      computedData: [
        { alias: "runtime_daily", value: 5400, lastUpdated: "2026-01-01T00:00:00Z" },
      ],
    });
    render(
      <MobileWidgetCard widget={{ ...widget, equipmentId: "pp-1" }} equipment={pump} />,
    );
    expect(screen.getByText(/ON/)).toBeTruthy();
    expect(screen.getByText(/1h 30m/)).toBeTruthy();
  });

  // Issue #325 divergence 3 — a boolean-category sensor emitting a string
  // ("OFF" contact) must render the same localized label as a real boolean,
  // not the raw string (same rule as the desktop SensorValues, #315).
  it("normalizes a string-valued contact sensor through the boolean formatter", () => {
    const door = makeEquipment({
      id: "se-1",
      name: "Door",
      type: "sensor",
      dataBindings: [
        {
          id: "db-c",
          equipmentId: "se-1",
          deviceDataId: "dd-c",
          alias: "contact",
          deviceId: "dev-c",
          deviceName: "Door sensor",
          key: "contact",
          type: "enum",
          category: "contact_door",
          value: "OFF",
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ] as EquipmentWithDetails["dataBindings"],
    });
    render(
      <MobileWidgetCard widget={{ ...widget, equipmentId: "se-1" }} equipment={door} />,
    );
    // "OFF" on a contact means open — the localized label, never the raw string.
    expect(screen.getByText(i18n.t("controls.opened") as string)).toBeTruthy();
    expect(screen.queryByText("OFF")).toBeNull();
  });

  it("understands an explicit OPEN string on a contact sensor", () => {
    const door = makeEquipment({
      id: "se-2",
      name: "Gate door",
      type: "sensor",
      dataBindings: [
        {
          id: "db-c2",
          equipmentId: "se-2",
          deviceDataId: "dd-c2",
          alias: "contact",
          deviceId: "dev-c2",
          deviceName: "Door sensor",
          key: "contact",
          type: "enum",
          category: "contact_door",
          value: "OPEN",
          lastUpdated: "2026-01-01T00:00:00Z",
          lastChanged: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ] as EquipmentWithDetails["dataBindings"],
    });
    render(
      <MobileWidgetCard widget={{ ...widget, equipmentId: "se-2" }} equipment={door} />,
    );
    expect(screen.getByText(i18n.t("controls.opened") as string)).toBeTruthy();
    expect(screen.queryByText("OPEN")).toBeNull();
  });
});

function makeEquipment(over: Partial<EquipmentWithDetails>): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Equipment",
    zoneId: "z-1",
    type: "switch",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [],
    orderBindings: [],
    ...over,
  } as EquipmentWithDetails;
}

function stateDataBinding(over: Record<string, unknown>) {
  return {
    id: "db-s",
    equipmentId: "eq-1",
    deviceDataId: "dd-s",
    alias: "state",
    deviceId: "dev-1",
    deviceName: "Device",
    key: "state",
    type: "boolean",
    category: "light_state",
    value: false,
    lastUpdated: "2026-01-01T00:00:00Z",
    lastChanged: "2026-01-01T00:00:00Z",
    stale: false,
    ...over,
  };
}
