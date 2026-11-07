import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, userEvent } from "../test-utils";
import i18n from "../i18n";
import { DashboardPage } from "./DashboardPage";
import { useDashboard } from "../store/useDashboard";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { useRecipes } from "../store/useRecipes";
import { useAuth } from "../store/useAuth";
import type { DashboardWidget, User } from "../types";

// The grid itself is not under test: what matters is how editing starts.
vi.mock("../components/dashboard/WidgetGrid", () => ({
  WidgetGrid: ({ editMode }: { editMode: boolean }) => (
    <div data-testid="grid" data-edit={String(editMode)} />
  ),
}));

// Spec 196, decision pr6-edition — below lg the edit action was a floating
// button over the tiles. It is a button under the grid now, and a bar that
// stays at the bottom while editing; desktop keeps its header buttons.

const widget: DashboardWidget = {
  id: "w1",
  type: "equipment",
  equipmentId: "eq-1",
  displayOrder: 0,
  createdAt: "2026-11-07T00:00:00Z",
};

function asUser(role: "admin" | "standard") {
  const user: User = {
    id: "u1",
    username: "marc",
    displayName: "Marc",
    role,
    preferences: {} as User["preferences"],
    enabled: true,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
  useAuth.setState({ user });
}

describe("DashboardPage editing", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
    const noop = vi.fn().mockResolvedValue(undefined);
    useDashboard.setState({ widgets: [widget], fetchWidgets: noop });
    useEquipments.setState({ equipments: [], fetchEquipments: noop });
    useZones.setState({ tree: [], fetchZones: noop });
    useRecipes.setState({ fetchRecipes: noop, fetchInstances: noop });
  });

  it("offers editing under the grid, with no floating button", async () => {
    asUser("admin");
    render(<DashboardPage />);
    const start = screen.getByRole("button", { name: "Modifier l'accueil" });
    expect(start.className).toContain("lg:hidden");
    expect(document.querySelector(".fixed")).toBeNull();

    await userEvent.click(start);
    expect(screen.getByTestId("grid").dataset.edit).toBe("true");
    const bar = screen.getByTestId("dashboard-edit-bar");
    expect(bar.className).toContain("sticky");
    expect(bar.textContent).toContain("Ajouter un widget");
    expect(screen.queryByRole("button", { name: "Modifier l'accueil" })).toBeNull();

    // « Terminé » appears twice (desktop header, bar below lg): the bar's ends editing.
    const done = screen.getAllByRole("button", { name: "Terminé" });
    await userEvent.click(done[done.length - 1]);
    expect(screen.getByTestId("grid").dataset.edit).toBe("false");
    expect(screen.queryByTestId("dashboard-edit-bar")).toBeNull();
  });

  it("keeps the desktop header button, now « Modifier »", () => {
    asUser("admin");
    render(<DashboardPage />);
    expect(screen.getByRole("button", { name: "Modifier" })).toBeTruthy();
  });

  it("shows no edit action to a standard user", () => {
    asUser("standard");
    render(<DashboardPage />);
    expect(screen.queryByRole("button", { name: "Modifier l'accueil" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull();
  });
});
