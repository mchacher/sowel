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

// Spec 217 — a heater warms the zone in its comfort modes, and never drives the
// thermostats' on/off button.
describe("zone heating with heaters", () => {
  const heater = (alias: string, category: string, value: unknown) =>
    ({
      ...thermostat("h", 20),
      type: "heater",
      dataBindings: [{ alias, category, value }],
      orderBindings: [],
    }) as unknown as EquipmentWithDetails;
  const relay = (on: boolean) => heater("state", "light_state", on);
  const pilot = (mode: string) => heater("pilot_wire_mode", "pilot_wire_mode", mode);

  it.each([
    ["relay comfort", relay(false), true],
    ["relay eco", relay(true), false],
    ["pilot comfort", pilot("comfort_minus_1"), true],
    ["pilot eco", pilot("eco"), false],
  ])("%s", (_n, eq, warm) => {
    const tile = render(<ZoneWidget widget={WIDGET} zone={ZONE} equipments={[eq]} />);
    expect(tile.container.querySelector("svg.text-heat") !== null).toBe(warm);
    tile.unmount();

    const sheet = render(
      <ZoneDetailSheet widget={WIDGET} zone={ZONE} equipments={[eq]} onClose={vi.fn()} />,
    );
    expect(sheet.baseElement.querySelector("svg.text-heat") !== null).toBe(warm);
  });

  it.each([
    ["a warm pilot heater", pilot("comfort")],
    ["a relay heater in eco", relay(true)],
  ])("turns the thermostats on beside %s", (_n, eq) => {
    vi.mocked(api.executeZoneOrder).mockResolvedValue(undefined as never);
    render(<ZoneWidget widget={WIDGET} zone={ZONE} equipments={[thermostat("a", 20), eq]} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(api.executeZoneOrder).toHaveBeenCalledWith("z1", "allThermostatsPowerOn", undefined);
  });
});

// Spec 218 — every heater of the zone in one mode, from the tile and the sheet.
describe("zone heaters mode", () => {
  beforeEach(() => vi.clearAllMocks());

  const heater = (id: string, data: object, orders: object[]) =>
    ({
      ...thermostat(id, 20),
      type: "heater",
      dataBindings: [data],
      orderBindings: orders,
    }) as unknown as EquipmentWithDetails;
  const relay = (id: string, on: boolean) =>
    heater(id, { alias: "state", category: "light_state", value: on ? "ON" : "OFF" }, [
      { alias: "state", category: "light_toggle", enumValues: ["ON", "OFF"] },
    ]);
  const pilot = (id: string, mode: string) =>
    heater(id, { alias: "pilot_wire_mode", category: "pilot_wire_mode", value: mode }, [
      {
        alias: "pilot_wire_mode",
        category: "set_pilot_wire_mode",
        enumValues: ["comfort", "eco", "frost_protection"],
      },
    ]);

  it("tile: no thermostat on/off in a heaters-only zone; the menu sends the mode", () => {
    vi.mocked(api.executeZoneOrder).mockResolvedValue(undefined as never);
    render(
      <ZoneWidget
        widget={WIDGET}
        zone={ZONE}
        equipments={[relay("r", false), pilot("p", "comfort")]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
    expect(screen.getByText("Comfort")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "All heaters" }));
    const items = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(items).toEqual(["Comfort", "Eco", "Frost protection"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Frost protection" }));
    expect(api.executeZoneOrder).toHaveBeenCalledWith("z1", "allHeatersMode", "frost_protection");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("tile: says « Mixed » when the heaters differ; relays only offer comfort and eco", () => {
    render(
      <ZoneWidget widget={WIDGET} zone={ZONE} equipments={[relay("a", false), relay("b", true)]} />,
    );
    expect(screen.getByText("Mixed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All heaters" }));
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Comfort", "Eco"]);
  });

  // #1331 — one relay Sowel has no reading of: unknown, not « Mixed ».
  it("tile: says « Unknown » for a lone relay with no reading", () => {
    const unread = heater("u", { alias: "state", category: "light_state", value: null }, [
      { alias: "state", category: "light_toggle", enumValues: ["ON", "OFF"] },
    ]);
    render(<ZoneWidget widget={WIDGET} zone={ZONE} equipments={[unread]} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText("Mixed")).toBeNull();
  });

  it("sheet: one button per mode, no thermostat on/off", () => {
    vi.mocked(api.executeZoneOrder).mockResolvedValue(undefined as never);
    render(
      <ZoneDetailSheet
        widget={WIDGET}
        zone={ZONE}
        equipments={[pilot("p", "eco")]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Turn on/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Eco" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Comfort" }));
    expect(api.executeZoneOrder).toHaveBeenCalledWith("z1", "allHeatersMode", "comfort");
  });
});
