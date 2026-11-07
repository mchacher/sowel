/**
 * Spec 196, slice 8a (phase 3 review) — the zone heating tile's setpoint.
 *
 * A refused zone order reverts the stepper and says so, like a single
 * thermostat's; and the value asked for stays on screen while the zone's
 * thermostats report one by one, until their average reaches it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "../../test-utils";
import { ZoneWidget } from "./ZoneWidget";
import { ZoneDetailSheet } from "./WidgetDetailSheet";
import * as api from "../../api";
import type { DashboardWidget, EquipmentWithDetails, ZoneWithChildren } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  executeZoneOrder: vi.fn(),
}));

function thermostat(id: string, setpoint: number): EquipmentWithDetails {
  return {
    id,
    name: id,
    zoneId: "z1",
    type: "thermostat",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [
      { alias: "temperature", value: 19 },
      { alias: "setpoint", value: setpoint },
    ],
    orderBindings: [{ alias: "setpoint", deviceId: "dev-1", min: 16, max: 30 }],
  } as unknown as EquipmentWithDetails;
}

const ZONE = { id: "z1", name: "Salon", children: [] } as unknown as ZoneWithChildren;
const WIDGET = {
  id: "w1",
  type: "zone",
  zoneId: "z1",
  family: "heating",
  label: "",
} as unknown as DashboardWidget;

async function flushPromises() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

async function stepUp() {
  fireEvent.click(screen.getByRole("button", { name: /Raise|Increase/i }));
  await act(async () => {
    vi.advanceTimersByTime(1_000);
  });
  await flushPromises();
}

describe("zone heating setpoint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("tile: a refused order reverts the value and says « not applied »", async () => {
    vi.mocked(api.executeZoneOrder).mockRejectedValue(new Error("502"));
    render(
      <ZoneWidget
        widget={WIDGET}
        zone={ZONE}
        equipments={[thermostat("a", 20), thermostat("b", 20)]}
      />,
    );

    await stepUp();

    expect(api.executeZoneOrder).toHaveBeenCalledWith("z1", "allThermostatsSetpoint", 20.5);
    expect(screen.getByRole("status").textContent).toBe("Setpoint not applied");
    expect(screen.getByText(/20\.0/)).toBeTruthy();
  });

  it("tile: writes the setpoint in the tile form, « 20.0° » (#1129, pr3-degre)", () => {
    render(
      <ZoneWidget
        widget={WIDGET}
        zone={ZONE}
        equipments={[thermostat("a", 20), thermostat("b", 20)]}
      />,
    );
    expect(screen.getByText("20.0°")).toBeTruthy();
    expect(screen.queryByText("20.0 °C")).toBeNull();
  });

  it("sheet: a refused order says « not applied » too", async () => {
    vi.mocked(api.executeZoneOrder).mockRejectedValue(new Error("502"));
    render(
      <ZoneDetailSheet
        widget={WIDGET}
        zone={ZONE}
        equipments={[thermostat("a", 20), thermostat("b", 20)]}
        onClose={vi.fn()}
      />,
    );

    await stepUp();

    expect(screen.getByRole("status").textContent).toBe("Setpoint not applied");
  });

  it("tile: holds the value asked for until the zone's average reaches it", async () => {
    vi.mocked(api.executeZoneOrder).mockResolvedValue(undefined as never);
    const { rerender } = render(
      <ZoneWidget
        widget={WIDGET}
        zone={ZONE}
        equipments={[thermostat("a", 20), thermostat("b", 20)]}
      />,
    );

    await stepUp();
    expect(screen.getByTestId("setpoint-pending")).toBeTruthy();

    // One thermostat reported: the average reads 20.25, the tile keeps 20.5.
    rerender(
      <ZoneWidget
        widget={WIDGET}
        zone={ZONE}
        equipments={[thermostat("a", 20.5), thermostat("b", 20)]}
      />,
    );
    expect(screen.getByTestId("setpoint-pending")).toBeTruthy();
    expect(screen.getByText(/20\.5/)).toBeTruthy();

    // Both did: the hold ends.
    rerender(
      <ZoneWidget
        widget={WIDGET}
        zone={ZONE}
        equipments={[thermostat("a", 20.5), thermostat("b", 20.5)]}
      />,
    );
    expect(screen.queryByTestId("setpoint-pending")).toBeNull();
  });
});
