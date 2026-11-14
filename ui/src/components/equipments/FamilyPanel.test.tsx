import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { FamilyPanel } from "./FamilyPanel";
import * as api from "../../api";
import type { EquipmentWithDetails } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  updateEquipment: vi.fn().mockResolvedValue(undefined),
}));

function plug(family?: EquipmentWithDetails["family"]): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Radiateur Bureau",
    zoneId: "z-1",
    type: "switch",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    family,
    dataBindings: [],
    orderBindings: [],
    status: "online",
  };
}

describe("FamilyPanel (spec 208)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void i18n.changeLanguage("en");
  });

  it("starts on None and saves the family picked", async () => {
    const onUpdated = vi.fn();
    render(<FamilyPanel defaultOpen equipment={plug()} onUpdated={onUpdated} />);
    const select = screen.getByRole("combobox", { name: "Family" }) as HTMLSelectElement;
    expect(select.value).toBe("");

    await userEvent.selectOptions(select, "climate");

    expect(api.updateEquipment).toHaveBeenCalledWith("eq-1", { family: "climate" });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("puts the plug back with the plugs on None", async () => {
    render(<FamilyPanel defaultOpen equipment={plug("climate")} onUpdated={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Family" }) as HTMLSelectElement;
    expect(select.value).toBe("climate");

    await userEvent.selectOptions(select, "");

    expect(api.updateEquipment).toHaveBeenCalledWith("eq-1", { family: null });
  });
});
