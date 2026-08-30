/**
 * Spec 169 — the Recipe tab exists only when a recipe can actually go in it.
 *
 * No recipe in the registry declares a `tile` today, so an always-visible third
 * tab would greet every user with "nothing available". These cases pin the tab
 * to the content it offers, and pin the picker's filter: an instance whose
 * recipe declares no tile must not be listed even when the tab is open.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "../../test-utils";
import { AddWidgetModal } from "./AddWidgetModal";
import { useRecipes } from "../../store/useRecipes";
import type { RecipeInfo, RecipeInstance } from "../../types";

function recipe(id: string, tile?: RecipeInfo["tile"]): RecipeInfo {
  return {
    id,
    name: id,
    description: "",
    slots: [],
    actions: [],
    ...(tile ? { tile } : {}),
  };
}

function instance(id: string, recipeId: string): RecipeInstance {
  return {
    id,
    recipeId,
    params: {},
    enabled: true,
    createdAt: "2026-08-30T10:00:00Z",
    state: {},
  };
}

function renderModal(onAddRecipe = vi.fn()) {
  render(
    <AddWidgetModal
      equipments={[]}
      zones={[]}
      onAddEquipment={vi.fn()}
      onAddZone={vi.fn()}
      onAddRecipe={onAddRecipe}
      onClose={vi.fn()}
    />,
  );
  return onAddRecipe;
}

describe("AddWidgetModal — recipe tab (spec 169)", () => {
  beforeEach(() => {
    useRecipes.setState({ instances: [], recipes: [] });
  });

  it("hides the Recipe tab when no recipe declares a tile", () => {
    useRecipes.setState({
      instances: [instance("ri1", "plain")],
      recipes: [recipe("plain")],
    });
    renderModal();

    expect(screen.getByRole("button", { name: "Equipment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zone" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Recipe" })).toBeNull();
  });

  it("hides the Recipe tab when there is no recipe instance at all", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: "Recipe" })).toBeNull();
  });

  it("shows the Recipe tab as soon as one instance is pinnable", () => {
    useRecipes.setState({
      instances: [instance("ri1", "gate")],
      recipes: [recipe("gate", { icon: "Truck" })],
    });
    renderModal();

    expect(screen.getByRole("button", { name: "Recipe" })).toBeTruthy();
  });

  it("lists only the instances whose recipe declares a tile, and pins the one clicked", () => {
    useRecipes.setState({
      instances: [instance("ri-plain", "plain"), instance("ri-gate", "gate")],
      recipes: [recipe("plain"), recipe("gate", { icon: "Truck" })],
    });
    const onAddRecipe = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Recipe" }));
    expect(screen.queryByRole("button", { name: /plain/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /gate/ }));
    expect(onAddRecipe).toHaveBeenCalledWith("ri-gate");
  });
});
