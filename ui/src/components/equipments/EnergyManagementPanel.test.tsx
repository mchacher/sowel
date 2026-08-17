import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { EnergyManagementPanel } from "./EnergyManagementPanel";
import { useArbiter } from "../../store/useArbiter";
import * as api from "../../api";
import type { EquipmentWithDetails, EnergyLoadProfile, EquipmentType } from "../../types";

// The panel calls the arbiter store's fetch() on mount; stub the network call
// so mounting is inert and no state leaks between tests.
vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getArbiterState: vi.fn().mockRejectedValue(new Error("no network in test")),
  updateEquipment: vi.fn().mockResolvedValue(undefined),
  resumeArbiterEquipment: vi.fn().mockResolvedValue(undefined),
}));

function equipment(
  type: EquipmentType,
  energyProfile?: EnergyLoadProfile,
): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Test load",
    zoneId: "z-1",
    type,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    energyProfile,
    dataBindings: [],
    orderBindings: [],
    status: "online",
  };
}

describe("EnergyManagementPanel — derived load class (#555)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useArbiter.setState({ state: null, loading: false });
    void i18n.changeLanguage("en");
  });

  it("no longer exposes a class selector", async () => {
    render(<EnergyManagementPanel equipment={equipment("water_heater")} onUpdated={() => {}} />);
    await userEvent.click(screen.getByLabelText("Flexible load"));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Class")).toBeNull();
  });

  it("derives class 'deferrable' from a relay-type equipment on save", async () => {
    render(<EnergyManagementPanel equipment={equipment("water_heater")} onUpdated={() => {}} />);
    await userEvent.click(screen.getByLabelText("Flexible load"));
    await userEvent.type(screen.getByLabelText("Nominal power (W)"), "2000");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(api.updateEquipment).toHaveBeenCalledWith(
      "eq-1",
      expect.objectContaining({
        energyProfile: expect.objectContaining({ class: "deferrable", nominalPowerW: 2000 }),
      }),
    );
  });

  it("derives class 'comfort' from a self-regulating equipment on save", async () => {
    render(<EnergyManagementPanel equipment={equipment("thermostat")} onUpdated={() => {}} />);
    await userEvent.click(screen.getByLabelText("Flexible load"));
    await userEvent.type(screen.getByLabelText("Nominal power (W)"), "1800");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(api.updateEquipment).toHaveBeenCalledWith(
      "eq-1",
      expect.objectContaining({
        energyProfile: expect.objectContaining({ class: "comfort" }),
      }),
    );
  });

  it("cannot declare a type with no energy semantics as a flexible load", () => {
    render(<EnergyManagementPanel equipment={equipment("switch")} onUpdated={() => {}} />);
    const toggle = screen.getByLabelText("Flexible load") as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.queryByText(/no flexible-load behaviour/i)).not.toBeNull();
  });

  it("still edits an already-saved profile on a type with no derived class (never orphaned)", () => {
    const profile: EnergyLoadProfile = {
      class: "deferrable",
      nominalPowerW: 500,
      minOnS: 900,
      minOffS: 300,
    };
    render(
      <EnergyManagementPanel equipment={equipment("switch", profile)} onUpdated={() => {}} />,
    );
    // Toggle stays enabled and the form is revealed with the saved values.
    const toggle = screen.getByLabelText("Flexible load") as HTMLInputElement;
    expect(toggle.disabled).toBe(false);
    expect((screen.getByLabelText("Nominal power (W)") as HTMLInputElement).value).toBe("500");
  });
});
