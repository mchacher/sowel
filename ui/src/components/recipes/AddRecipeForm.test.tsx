import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { AddRecipeForm } from "./AddRecipeForm";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import type { RecipeInfo, EquipmentWithDetails, ZoneWithChildren } from "../../types";

// Component-test tier (issue #458). AddRecipeForm is one of the two sub-forms
// extracted from ZoneRecipesSection (#456). These pin the highest-value paths:
// the configure form renders its recipe's slots, submitting builds params with
// the zone pinned to the section's zone and fires createInstance, and a missing
// required slot blocks submission with an inline error.

function zone(id: string, name: string, children: ZoneWithChildren[] = []): ZoneWithChildren {
  return { id, name, parentId: null, displayOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", children };
}

function equipment(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
  return {
    id: "eq-1",
    name: "Ceiling light",
    zoneId: "z-salon",
    type: "light_onoff",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [],
    orderBindings: [],
    ...over,
  };
}

const RECIPE: RecipeInfo = {
  id: "r-1",
  name: "Auto light",
  description: "Turn the light on with motion",
  slots: [
    { id: "zone", name: "Zone", description: "", type: "zone", required: true },
    { id: "light", name: "Light", description: "The light to drive", type: "equipment", required: true, constraints: { equipmentType: "light_onoff" } },
    { id: "delay", name: "Delay", description: "Minutes before off", type: "number", required: false },
  ],
};

function seedStores() {
  useZones.setState({ tree: [zone("z-salon", "Salon")] });
  useEquipments.setState({ equipments: [equipment()] });
  useZoneAggregation.setState({ data: {} });
}

describe("AddRecipeForm", () => {
  beforeEach(() => {
    seedStores();
  });

  it("renders the selected recipe's name, description and slot fields", () => {
    render(<AddRecipeForm zoneId="z-salon" recipes={[RECIPE]} initialRecipeId="r-1" onClose={vi.fn()} />);

    expect(screen.getAllByText("Auto light").length).toBeGreaterThan(0);
    expect(screen.getByText("Turn the light on with motion")).toBeTruthy();
    // The "zone" slot is never rendered as a field; the light equipment slot is.
    expect(screen.getByText("Light")).toBeTruthy();
    expect(screen.getByText("Delay")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ceiling light" })).toBeTruthy();
  });

  it("submits with the zone pinned and fires createInstance", async () => {
    const createInstance = vi.fn().mockResolvedValue({});
    useRecipes.setState({ createInstance, instances: [] });
    const onClose = vi.fn();
    render(<AddRecipeForm zoneId="z-salon" recipes={[RECIPE]} initialRecipeId="r-1" onClose={onClose} />);

    await userEvent.selectOptions(screen.getByRole("combobox"), "eq-1");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(createInstance).toHaveBeenCalledTimes(1);
    expect(createInstance).toHaveBeenCalledWith(
      "r-1",
      expect.objectContaining({ zone: "z-salon", light: "eq-1" }),
    );
  });

  it("blocks submission and shows an error when a required slot is empty", async () => {
    const createInstance = vi.fn().mockResolvedValue({});
    useRecipes.setState({ createInstance, instances: [] });
    render(<AddRecipeForm zoneId="z-salon" recipes={[RECIPE]} initialRecipeId="r-1" onClose={vi.fn()} />);

    // Do not pick the required light equipment.
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(createInstance).not.toHaveBeenCalled();
    expect(screen.getByText("Light is required")).toBeTruthy();
  });
});
