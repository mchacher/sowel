import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { ThermostatCard } from "./ThermostatCard";
import type { EquipmentWithDetails } from "../../types";

// ============================================================
// The PAC regression (#901 follow-up): on a submetered thermostat the
// `power` alias is a clamp wattage, the run state lives under `powerState`,
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
  { alias: "powerState", value: running },
  { alias: "temperature", value: 26 },
  { alias: "setpoint", value: 24.5 },
];

describe("ThermostatCard power state", () => {
  it("shows ON from powerState even though the power alias is a wattage", () => {
    render(
      <ThermostatCard
        equipment={equipment(pacBindings(true, 2974))}
        onExecuteOrder={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByTitle("Turn off")).toBeTruthy();
  });

  it("sends OFF when powerState reports running", async () => {
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
          { alias: "powerState", value: false },
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
          { alias: "powerState", value: false, lastUpdated: "2026-09-05T10:00:20Z" },
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
          { alias: "powerState", value: true, lastUpdated: "2026-09-05T10:00:30Z" },
          { alias: "temperature", value: 26 },
          { alias: "setpoint", value: 24.5 },
        ])}
        onExecuteOrder={exec}
      />,
    );
    expect(screen.getByTitle("Turn off")).toBeTruthy();
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
