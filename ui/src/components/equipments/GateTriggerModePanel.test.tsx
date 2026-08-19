import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { GateTriggerModePanel } from "./GateTriggerModePanel";
import * as api from "../../api";
import type { EquipmentWithDetails } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  updateEquipment: vi.fn().mockResolvedValue(undefined),
}));

function equipment(gateTriggerMode?: "fixed" | "toggle"): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "PorteGarageGauche",
    zoneId: "z-1",
    type: "gate",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    gateTriggerMode,
    dataBindings: [],
    orderBindings: [],
    status: "online",
  };
}

describe("GateTriggerModePanel (#627)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void i18n.changeLanguage("en");
  });

  it("reflects the current mode and persists a toggle to 'toggle'", async () => {
    const onUpdated = vi.fn();
    render(<GateTriggerModePanel equipment={equipment("fixed")} onUpdated={onUpdated} />);

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await userEvent.click(checkbox);

    expect(api.updateEquipment).toHaveBeenCalledWith("eq-1", { gateTriggerMode: "toggle" });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("persists a toggle back to 'fixed'", async () => {
    const onUpdated = vi.fn();
    render(<GateTriggerModePanel equipment={equipment("toggle")} onUpdated={onUpdated} />);

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await userEvent.click(checkbox);

    expect(api.updateEquipment).toHaveBeenCalledWith("eq-1", { gateTriggerMode: "fixed" });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("shows the toggle as off when gateTriggerMode is undefined (default)", () => {
    render(<GateTriggerModePanel equipment={equipment(undefined)} onUpdated={() => {}} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
});
