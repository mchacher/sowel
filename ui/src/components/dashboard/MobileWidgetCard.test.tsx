import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
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
});
