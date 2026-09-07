import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, userEvent, waitFor } from "../../test-utils";
import { ThermostatCard } from "./ThermostatCard";
import type { EquipmentWithDetails } from "../../types";

// ============================================================
// The PAC regression (#901 follow-up): on a submetered thermostat the
// `power` alias is a clamp wattage, the run state lives under `state`,
// and the optimistic toggle state must survive the clamp's frequent pushes
// until the run state itself is re-reported.
// ============================================================

interface BindingSpec {
  alias: string;
  value: unknown;
  lastUpdated?: string;
}

function equipment(bindings: BindingSpec[]): EquipmentWithDetails {
  return {
    id: "eq-pac",
    name: "PAC",
    type: "thermostat",
    enabled: true,
    dataBindings: bindings.map((b, i) => ({
      id: `b-${i}`,
      equipmentId: "eq-pac",
      alias: b.alias,
      value: b.value,
      lastUpdated: b.lastUpdated ?? "2026-09-05T10:00:00Z",
      lastChanged: "2026-09-05T10:00:00Z",
      deviceId: "dev-1",
      key: b.alias,
    })),
    orderBindings: [
      { id: "o-1", equipmentId: "eq-pac", alias: "power", key: "power", deviceId: "dev-1" },
      {
        id: "o-2",
        equipmentId: "eq-pac",
        alias: "setpoint",
        key: "targetTemperature",
        deviceId: "dev-1",
        min: 16,
        max: 30,
      },
    ],
  } as unknown as EquipmentWithDetails;
}

const pacBindings = (running: boolean, watts: number): BindingSpec[] => [
  { alias: "power", value: watts },
  { alias: "state", value: running },
  { alias: "temperature", value: 26 },
  { alias: "setpoint", value: 24.5 },
];

describe("ThermostatCard power state", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows ON from the state alias even though the power alias is a wattage", () => {
    render(
      <ThermostatCard
        equipment={equipment(pacBindings(true, 2974))}
        onExecuteOrder={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByTitle("Turn off")).toBeTruthy();
  });

  it("sends OFF when the state alias reports running", async () => {
    // Before the fix, `2974 === true` read as off and every tap sent ON — the
    // production log shows five ON orders in 90 s from a user trying to stop.
    const exec = vi.fn().mockResolvedValue(undefined);
    render(
      <ThermostatCard equipment={equipment(pacBindings(true, 2974))} onExecuteOrder={exec} />,
    );
    await userEvent.click(screen.getByTitle("Turn off"));
    expect(exec).toHaveBeenCalledWith("power", false);
  });

  it("keeps the optimistic toggle through clamp updates, reverts on run-state re-report", async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ThermostatCard equipment={equipment(pacBindings(false, 11))} onExecuteOrder={exec} />,
    );

    await userEvent.click(screen.getByTitle("Turn on"));
    expect(exec).toHaveBeenCalledWith("power", true);
    // Optimistic: shows ON before the device confirmed anything.
    await waitFor(() => expect(screen.getByTitle("Turn off")).toBeTruthy());

    // The clamp pushes a new wattage — unrelated to the run state, so the
    // optimistic ON must hold (this is what used to wipe it within seconds).
    rerender(
      <ThermostatCard
        equipment={equipment([
          { alias: "power", value: 14, lastUpdated: "2026-09-05T10:00:05Z" },
          { alias: "state", value: false },
          { alias: "temperature", value: 26 },
          { alias: "setpoint", value: 24.5 },
        ])}
        onExecuteOrder={exec}
      />,
    );
    expect(screen.getByTitle("Turn off")).toBeTruthy();

    // The device re-reports its run state as still off — the truth disagrees,
    // the optimistic value is dropped and the toggle reverts.
    rerender(
      <ThermostatCard
        equipment={equipment([
          { alias: "power", value: 14, lastUpdated: "2026-09-05T10:00:05Z" },
          { alias: "state", value: false, lastUpdated: "2026-09-05T10:00:20Z" },
          { alias: "temperature", value: 26 },
          { alias: "setpoint", value: 24.5 },
        ])}
        onExecuteOrder={exec}
      />,
    );
    await waitFor(() => expect(screen.getByTitle("Turn on")).toBeTruthy());
  });

  it("confirms the optimistic toggle when the run state agrees", async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ThermostatCard equipment={equipment(pacBindings(false, 11))} onExecuteOrder={exec} />,
    );
    await userEvent.click(screen.getByTitle("Turn on"));

    rerender(
      <ThermostatCard
        equipment={equipment([
          { alias: "power", value: 1800, lastUpdated: "2026-09-05T10:00:30Z" },
          { alias: "state", value: true, lastUpdated: "2026-09-05T10:00:30Z" },
          { alias: "temperature", value: 26 },
          { alias: "setpoint", value: 24.5 },
        ])}
        onExecuteOrder={exec}
      />,
    );
    expect(screen.getByTitle("Turn off")).toBeTruthy();
  });

  it("holds the optimistic toggle on an unmigrated submetered thermostat", async () => {
    // No state binding yet, `power` is the clamp wattage: there is no
    // truth source at all, so the clamp's pushes must NOT wipe the optimistic
    // toggle (the original symptom); only the TTL may.
    const exec = vi.fn().mockResolvedValue(undefined);
    const noState: BindingSpec[] = [
      { alias: "power", value: 11 },
      { alias: "temperature", value: 26 },
      { alias: "setpoint", value: 24.5 },
    ];
    const { rerender } = render(
      <ThermostatCard equipment={equipment(noState)} onExecuteOrder={exec} />,
    );

    await userEvent.click(screen.getByTitle("Turn on"));
    await waitFor(() => expect(screen.getByTitle("Turn off")).toBeTruthy());

    rerender(
      <ThermostatCard
        equipment={equipment([
          { alias: "power", value: 2974, lastUpdated: "2026-09-05T10:00:05Z" },
          { alias: "temperature", value: 26 },
          { alias: "setpoint", value: 24.5 },
        ])}
        onExecuteOrder={exec}
      />,
    );
    expect(screen.getByTitle("Turn off")).toBeTruthy();
  });

  it("expires an unconfirmed optimistic value after the TTL", async () => {
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue(undefined);
    render(
      <ThermostatCard
        equipment={equipment([
          { alias: "power", value: 11 },
          { alias: "temperature", value: 26 },
          { alias: "setpoint", value: 24.5 },
        ])}
        onExecuteOrder={exec}
      />,
    );

    fireEvent.click(screen.getByTitle("Turn on"));
    await act(async () => {});
    expect(screen.getByTitle("Turn off")).toBeTruthy();

    // Nothing ever confirms the order (no state binding, no re-report): the
    // card must fall back to the truth instead of showing ON forever.
    await act(async () => {
      vi.advanceTimersByTime(91_000);
    });
    expect(screen.getByTitle("Turn on")).toBeTruthy();
  });

  it("still reads a legacy boolean power binding", () => {
    render(
      <ThermostatCard
        equipment={equipment([
          { alias: "power", value: true },
          { alias: "temperature", value: 21 },
        ])}
        onExecuteOrder={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByTitle("Turn off")).toBeTruthy();
  });
});

// ============================================================
// Spec 177 — the card leads with the core and renders whatever else is bound
// generically. No vendor alias has a branch of its own any more: the MCZ
// surface, the Panasonic surface and a vendor Sowel has never met all go
// through the same shapes, chosen by the order's type.
// ============================================================

interface RichData {
  alias: string;
  value: unknown;
  unit?: string;
}
interface RichOrder {
  alias: string;
  type: "boolean" | "number" | "enum" | "text";
  enumValues?: string[];
  min?: number;
  max?: number;
  unit?: string;
}

function richEquipment(data: RichData[], orders: RichOrder[]): EquipmentWithDetails {
  return {
    id: "eq-rich",
    name: "Rich",
    type: "thermostat",
    enabled: true,
    dataBindings: data.map((b, i) => ({
      id: `b-${i}`,
      equipmentId: "eq-rich",
      alias: b.alias,
      value: b.value,
      unit: b.unit,
      lastUpdated: "2026-09-07T10:00:00Z",
      lastChanged: "2026-09-07T10:00:00Z",
      deviceId: "dev-1",
      key: b.alias,
    })),
    orderBindings: orders.map((o, i) => ({
      id: `o-${i}`,
      equipmentId: "eq-rich",
      alias: o.alias,
      key: o.alias,
      deviceId: "dev-1",
      type: o.type,
      enumValues: o.enumValues,
      min: o.min,
      max: o.max,
      unit: o.unit,
    })),
  } as unknown as EquipmentWithDetails;
}

const core: RichData[] = [
  { alias: "state", value: true },
  { alias: "temperature", value: 21.5 },
  { alias: "setpoint", value: 22 },
];
const coreOrders: RichOrder[] = [
  { alias: "power", type: "boolean" },
  { alias: "setpoint", type: "number", min: 5, max: 40 },
];

describe("ThermostatCard extras (spec 177)", () => {
  it("still shows and controls the full MCZ pellet-stove surface, as extras", async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    render(
      <ThermostatCard
        equipment={richEquipment(
          [
            ...core,
            { alias: "profile", value: "comfort" },
            { alias: "ecoMode", value: false },
            { alias: "stoveState", value: "running_p2" },
            { alias: "pelletSensor", value: "sufficient" },
            { alias: "ignitionCount", value: 42 },
          ],
          [
            ...coreOrders,
            { alias: "profile", type: "enum", enumValues: ["dynamic", "overnight", "comfort"] },
            { alias: "ecoMode", type: "boolean" },
            { alias: "resetAlarm", type: "boolean" },
          ],
        )}
        onExecuteOrder={exec}
      />,
    );

    expect(screen.getByText("Other settings")).toBeTruthy();
    // The profile is a programme, not an operating mode: no core mode selector.
    expect(screen.queryByText("Mode")).toBeNull();
    expect(screen.getByText("Profile")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Overnight" }));
    expect(exec).toHaveBeenCalledWith("profile", "overnight");

    // Boolean order with a data mirror → toggle, reads the mirror (off).
    await userEvent.click(screen.getByRole("button", { name: "OFF" }));
    expect(exec).toHaveBeenCalledWith("ecoMode", true);

    // Boolean order without a mirror → momentary action.
    await userEvent.click(screen.getByRole("button", { name: /Trigger/ }));
    expect(exec).toHaveBeenCalledWith("resetAlarm", true);

    // Readings with no order of their own → chips, translated where known.
    expect(screen.getByText("Power 2")).toBeTruthy();
    expect(screen.getByText("Sufficient")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("still shows and controls the full Panasonic surface: core mode, extras for the rest", async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    render(
      <ThermostatCard
        equipment={richEquipment(
          [
            ...core,
            { alias: "operationMode", value: "heat" },
            { alias: "fanSpeed", value: "low" },
            { alias: "nanoe", value: "off" },
            { alias: "airSwingUD", value: "up" },
          ],
          [
            ...coreOrders,
            { alias: "operationMode", type: "enum", enumValues: ["heat", "cool", "dry"] },
            { alias: "fanSpeed", type: "enum", enumValues: ["low", "high"] },
            { alias: "nanoe", type: "enum", enumValues: ["off", "on"] },
            { alias: "airSwingUD", type: "enum", enumValues: ["up", "down"] },
          ],
        )}
        onExecuteOrder={exec}
      />,
    );

    expect(screen.getByText("Mode")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cool" }));
    expect(exec).toHaveBeenCalledWith("operationMode", "cool");

    expect(screen.getByText("Fan speed")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "High" }));
    expect(exec).toHaveBeenCalledWith("fanSpeed", "high");

    expect(screen.getByText("Nanoe")).toBeTruthy();
    expect(screen.getByText("Vertical air swing")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Down" }));
    expect(exec).toHaveBeenCalledWith("airSwingUD", "down");
  });

  it("offers the reset-alarm action without a stove state to gate it", async () => {
    // Before spec 177 the button lived inside the stove-state badge and was
    // disabled unless that vendor string started with "error".
    const exec = vi.fn().mockResolvedValue(undefined);
    render(
      <ThermostatCard
        equipment={richEquipment(core, [...coreOrders, { alias: "resetAlarm", type: "boolean" }])}
        onExecuteOrder={exec}
      />,
    );
    const button = screen.getByRole("button", { name: /Trigger/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(button);
    expect(exec).toHaveBeenCalledWith("resetAlarm", true);
  });

  it("renders a vendor it has never met with humanised labels and raw values", async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    render(
      <ThermostatCard
        equipment={richEquipment(
          [...core, { alias: "swing", value: "on" }, { alias: "fanLevel", value: 3 }],
          [
            ...coreOrders,
            { alias: "swing", type: "enum", enumValues: ["on", "off"] },
            { alias: "fanLevel", type: "number", min: 1, max: 5 },
          ],
        )}
        onExecuteOrder={exec}
      />,
    );

    expect(screen.getByText("Swing")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "off" }));
    expect(exec).toHaveBeenCalledWith("swing", "off");

    expect(screen.getByText("Fan level")).toBeTruthy();
    await userEvent.click(screen.getByTitle("Fan level +"));
    expect(exec).toHaveBeenCalledWith("fanLevel", 4);
  });

  it("shows the optimistic value on an extra until its mirror re-reports", async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    render(
      <ThermostatCard
        equipment={richEquipment(
          [...core, { alias: "fanSpeed", value: "low" }],
          [...coreOrders, { alias: "fanSpeed", type: "enum", enumValues: ["low", "high"] }],
        )}
        onExecuteOrder={exec}
      />,
    );
    const high = screen.getByRole("button", { name: "High" });
    expect(high.className).not.toContain("text-primary");
    await userEvent.click(high);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "High" }).className).toContain("text-primary"),
    );
  });

  it("renders no extras section on a core-only thermostat", () => {
    render(
      <ThermostatCard
        equipment={richEquipment(
          [...core, { alias: "power", value: 1200 }, { alias: "outsideTemperature", value: 9 }],
          coreOrders,
        )}
        onExecuteOrder={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByText("Other settings")).toBeNull();
  });
});

describe("ThermostatCard extras — review follow-ups (spec 177)", () => {
  it("renders a legacy state ORDER as a toggle mirrored by the core state reading", async () => {
    // Bound before the toggle_power → power override: the order landed under
    // `state`. It is an extra, but its mirror is the core `state` reading, so
    // it must be a real toggle (sends false when on), never a one-shot.
    const exec = vi.fn().mockResolvedValue(undefined);
    render(
      <ThermostatCard
        equipment={richEquipment(core, [
          { alias: "setpoint", type: "number", min: 5, max: 40 },
          { alias: "state", type: "boolean" },
        ])}
        onExecuteOrder={exec}
      />,
    );
    expect(screen.queryByRole("button", { name: /Trigger/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "ON" }));
    expect(exec).toHaveBeenCalledWith("state", false);
  });

  it("keeps showing a reading whose order has no generic control", () => {
    render(
      <ThermostatCard
        equipment={richEquipment(
          [...core, { alias: "schedule", value: "weekday" }],
          [...coreOrders, { alias: "schedule", type: "text" }],
        )}
        onExecuteOrder={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText("weekday")).toBeTruthy();
  });
});
