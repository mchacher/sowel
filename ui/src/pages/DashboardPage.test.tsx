import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "../test-utils";
import i18n from "../i18n";
import { DashboardPage } from "./DashboardPage";
import { useDashboard } from "../store/useDashboard";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { useRecipes } from "../store/useRecipes";
import { useAuth } from "../store/useAuth";
import type { DashboardWidget, User } from "../types";
import * as api from "../api";
import { ApiError } from "../api/client";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, getDashboardWidgets: vi.fn() };
});

const getDashboardWidgets = api.getDashboardWidgets as unknown as ReturnType<typeof vi.fn>;
const realFetchWidgets = useDashboard.getState().fetchWidgets;

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
    useDashboard.setState({ widgets: [widget], loaded: true, error: null, fetchWidgets: noop });
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

// Issue #1150 — opened before its data arrived, the dashboard said « Aucun widget
// configuré », which reads as a lost dashboard. The empty state now needs a load that
// succeeded with no widget; until then a loading state, and on failure the error.
describe("DashboardPage loading", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
    vi.clearAllMocks();
    const noop = vi.fn().mockResolvedValue(undefined);
    useDashboard.setState({
      widgets: [],
      loaded: false,
      loading: false,
      error: null,
      fetchWidgets: realFetchWidgets,
    });
    useEquipments.setState({ equipments: [], fetchEquipments: noop });
    useZones.setState({ tree: [], fetchZones: noop });
    useRecipes.setState({ fetchRecipes: noop, fetchInstances: noop });
    asUser("admin");
  });

  it("shows a loading state, not the empty state, while the widgets load", () => {
    getDashboardWidgets.mockReturnValue(new Promise(() => {}));
    render(<DashboardPage />);
    expect(screen.getByRole("status", { name: "Chargement…" })).toBeTruthy();
    expect(screen.queryByText("Aucun widget configuré")).toBeNull();
  });

  it("shows the translated error with a retry when the load fails", async () => {
    getDashboardWidgets.mockRejectedValueOnce(new ApiError(0, "Failed to fetch"));
    render(<DashboardPage />);
    expect(
      await screen.findByText("Sowel ne répond pas. Vérifiez la connexion puis réessayez."),
    ).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
    expect(screen.queryByText("Aucun widget configuré")).toBeNull();

    getDashboardWidgets.mockResolvedValueOnce([widget]);
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByTestId("grid")).toBeTruthy());
    expect(getDashboardWidgets).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state once a load has returned no widget", async () => {
    getDashboardWidgets.mockResolvedValueOnce([]);
    render(<DashboardPage />);
    expect(await screen.findByText("Aucun widget configuré")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
