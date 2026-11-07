import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "../test-utils";
import i18n from "../i18n";
import { RecipeModePill } from "./ZoneDetailPage";
import type { RecipeActionDef, RecipeInfo, RecipeInstance } from "../types";

// Spec 196, slice 2a — the zone page's mode pill read `t("lang")`, a key that
// does not exist, so the language was always "" and the recipe's own labels
// were never looked up: a French page showed « Comfort ».

const action: RecipeActionDef = {
  id: "set_mode",
  type: "cycle",
  stateKey: "mode",
  options: [
    { value: "eco", label: "Eco" },
    { value: "comfort", label: "Comfort" },
  ],
};

const recipe: RecipeInfo = {
  id: "zone-thermostat",
  name: "Zone thermostat",
  description: "",
  slots: [],
  actions: [action],
  i18n: { fr: { name: "Thermostat de zone", description: "", slots: {} } },
};

const instance: RecipeInstance = {
  id: "inst-1",
  recipeId: recipe.id,
  params: {},
  enabled: true,
  createdAt: "2026-11-07T00:00:00Z",
  state: { mode: "comfort" },
};

describe("RecipeModePill", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows the current mode in French when the recipe ships a French pack", async () => {
    await i18n.changeLanguage("fr");
    render(<RecipeModePill instance={instance} recipe={recipe} action={action} />);
    const pill = screen.getByRole("button");
    expect(pill.textContent).toBe("Confort");
    expect(pill.getAttribute("title")).toBe("Cliquer pour passer en Éco");
  });

  it("keeps the recipe's own label in English", () => {
    render(<RecipeModePill instance={instance} recipe={recipe} action={action} />);
    expect(screen.getByRole("button").textContent).toBe("Comfort");
  });
});
