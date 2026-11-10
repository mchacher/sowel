import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "../../test-utils";
import { CardModePills } from "./CardModePills";
import { WidgetCard } from "./WidgetCard";
import { MobileWidgetCard } from "./MobileWidgetCard";
import { TileEquipmentContext } from "../equipments/order-outcome";
import { useRecipes } from "../../store/useRecipes";
import type {
  DashboardWidget,
  EquipmentWithDetails,
  RecipeInfo,
  RecipeInstance,
} from "../../types";

// Spec 201 — the mode of the recipe driving an equipment, on its Dashboard card.

const recipe: RecipeInfo = {
  id: "presence-thermostat",
  name: "Presence thermostat",
  description: "",
  slots: [
    { id: "thermostat", name: "", description: "", type: "equipment", required: true },
    { id: "buttons", name: "", description: "", type: "equipment", required: false, list: true },
  ],
  actions: [
    {
      id: "set_mode",
      type: "cycle",
      stateKey: "currentMode",
      options: [
        { value: "eco", label: "Eco" },
        { value: "cocoon", label: "Cocoon" },
      ],
      targets: ["thermostat"],
    },
  ],
};

const instance: RecipeInstance = {
  id: "i1",
  recipeId: "presence-thermostat",
  params: { thermostat: "poele", buttons: ["switch-cocoon"] },
  enabled: true,
  createdAt: "2026-11-01T00:00:00Z",
  state: { currentMode: "cocoon" },
};

const stove: EquipmentWithDetails = {
  id: "poele",
  name: "Poele",
  type: "thermostat",
  zoneId: "z-1",
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "online",
  dataBindings: [],
  orderBindings: [],
};

const widget = { id: "w1", type: "equipment", equipmentId: "poele" } as DashboardWidget;

beforeEach(() => {
  useRecipes.setState({ recipes: [recipe], instances: [instance] });
});

describe("CardModePills", () => {
  it("shows the current mode of the recipe driving the equipment", () => {
    render(<CardModePills equipmentId="poele" />);
    expect(screen.getByTestId("card-mode-pill").textContent).toBe("Cocoon");
  });

  it("renders nothing for an equipment no recipe drives", () => {
    const { container } = render(<CardModePills equipmentId="switch-cocoon" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("cards", () => {
  it("puts the pill on a computer card, the title unchanged", () => {
    render(
      <MemoryRouter>
        <TileEquipmentContext.Provider value="poele">
          <WidgetCard label="Poele">
            <p>body</p>
          </WidgetCard>
        </TileEquipmentContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("card-mode-pill").textContent).toBe("Cocoon");
    expect(screen.getByRole("link", { name: "Poele" })).toBeTruthy();
  });

  it("puts the pill on a phone card, under the label and zone", () => {
    render(<MobileWidgetCard widget={widget} equipment={stove} equipmentZone="Salon" />);
    const pill = screen.getByTestId("card-mode-pill");
    expect(pill.textContent).toBe("Cocoon");
    expect(pill.parentElement?.parentElement?.textContent).toContain("Salon");
  });
});
