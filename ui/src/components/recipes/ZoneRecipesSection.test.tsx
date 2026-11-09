import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "../../test-utils";
import { ZoneRecipesSection } from "./ZoneRecipesSection";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { useAuth } from "../../store/useAuth";
import type { RecipeInfo, RecipeInstance, EquipmentWithDetails, User } from "../../types";

// Spec 198 — instances of one recipe in a zone read as one group.

const WATCH: RecipeInfo = {
  id: "state-watch",
  name: "State watch",
  description: "",
  icon: "Eye",
  slots: [
    { id: "zone", name: "Zone", description: "", type: "zone", required: true },
    { id: "equipment", name: "Equipment", description: "", type: "equipment", required: true },
  ],
};
const THERMO: RecipeInfo = {
  id: "presence-thermostat",
  name: "Presence thermostat",
  description: "",
  icon: "Thermometer",
  slots: [
    { id: "zone", name: "Zone", description: "", type: "zone", required: true },
    { id: "thermostat", name: "Thermostat", description: "", type: "equipment", required: true },
  ],
};

const stove: EquipmentWithDetails = {
  id: "eq-stove",
  name: "Poele",
  zoneId: "z-rdc",
  type: "thermostat",
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "online",
  dataBindings: [],
  orderBindings: [],
} as EquipmentWithDetails;

function inst(id: string, recipeId: string, state: Record<string, unknown> = {}): RecipeInstance {
  const slot = recipeId === "state-watch" ? "equipment" : "thermostat";
  return {
    id,
    recipeId,
    params: { zone: "z-rdc", [slot]: "eq-stove" },
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    state,
  };
}

const admin: User = {
  id: "u-1",
  username: "admin",
  displayName: "Admin",
  role: "admin",
  preferences: {} as User["preferences"],
  enabled: true,
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("ZoneRecipesSection", () => {
  beforeEach(() => {
    useAuth.setState({ user: admin });
    useZones.setState({ tree: [] });
    useEquipments.setState({ equipments: [stove] });
    useZoneAggregation.setState({ data: {} });
  });

  it("groups two watches of the stove under one name, flagging the one in alarm", () => {
    useRecipes.setState({
      recipes: [WATCH, THERMO],
      instances: [
        inst("th", "presence-thermostat"),
        inst("a01", "state-watch", { summary: "Erreur A01 après 1 min" }),
        inst("a02", "state-watch", { summary: "Erreur A02 en alarme", alarm: true }),
      ],
      fetchRecipes: vi.fn().mockResolvedValue(undefined),
      fetchInstances: vi.fn().mockResolvedValue(undefined),
    });
    render(<ZoneRecipesSection zoneId="z-rdc" zoneName="RDC" />);

    const group = screen.getByRole("group", { name: "State watch" });
    expect(within(group).getByText("2 instances")).toBeTruthy();
    expect(
      within(group).getByRole("button", { name: "Poele, Erreur A01 après 1 min" }),
    ).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Poele, Erreur A02 en alarme" })).toBeTruthy();
    // One dot on the group header, one on nothing else (children carry no icon).
    expect(within(group).getAllByRole("img", { name: "In alarm" })).toHaveLength(1);
    // The single instance stays a two-line row, outside the group.
    expect(screen.getByText("Presence thermostat")).toBeTruthy();
    expect(group.contains(screen.getByText("Presence thermostat"))).toBe(false);
    // The recipe name is written once for the two watches.
    expect(screen.getAllByText("State watch")).toHaveLength(1);
  });
});
