import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { RecipeInstanceRow } from "./RecipeInstanceRow";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { useAuth } from "../../store/useAuth";
import type { RecipeInfo, RecipeInstance, EquipmentWithDetails, ZoneWithChildren, User } from "../../types";

// Component-test tier (issue #458). RecipeInstanceRow is the ~700-line row
// extracted from ZoneRecipesSection (#456). These pin the highest-value paths:
// the row shows the recipe name, the enable/disable toggle dispatches the
// matching store action, clicking the name opens the inline edit form with the
// slots pre-filled and Save gated on an actual change, and non-admins get a
// read-only row (no toggle, no action buttons).

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

function makeInstance(over: Partial<RecipeInstance> = {}): RecipeInstance {
  return {
    id: "ri-1",
    recipeId: "r-1",
    params: { zone: "z-salon", light: "eq-1", delay: "5" },
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    state: {},
    ...over,
  };
}

function adminUser(): User {
  return {
    id: "u-1",
    username: "admin",
    displayName: "Admin",
    role: "admin",
    preferences: {} as User["preferences"],
    enabled: true,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function seedStores(instance: RecipeInstance, overrides: Partial<Parameters<typeof useRecipes.setState>[0]> = {}) {
  useAuth.setState({ user: adminUser() });
  useZones.setState({ tree: [zone("z-salon", "Salon")] });
  useEquipments.setState({ equipments: [equipment()] });
  useZoneAggregation.setState({ data: {} });
  useRecipes.setState({
    instances: [instance],
    enableInstance: vi.fn().mockResolvedValue(undefined),
    disableInstance: vi.fn().mockResolvedValue(undefined),
    deleteInstance: vi.fn().mockResolvedValue(undefined),
    updateInstance: vi.fn().mockResolvedValue(undefined),
    getLog: vi.fn().mockResolvedValue([]),
    sendAction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

/** Report a viewport to `useIsMobile` (matchMedia `(max-width: 639px)`). */
function setViewport(mobile: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: mobile,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const LOG_ENTRY = {
  id: 1,
  instanceId: "ri-1",
  timestamp: "2026-01-01T12:00:00Z",
  message: "Recipe fired",
  level: "info" as const,
};

describe("RecipeInstanceRow", () => {
  beforeEach(() => {
    useAuth.setState({ user: adminUser() });
    setViewport(false); // desktop by default; a test opts into mobile explicitly
  });

  it("renders the recipe display name", () => {
    seedStores(makeInstance());
    render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);
    expect(screen.getByText("Auto light")).toBeTruthy();
  });

  it("disables an enabled instance from the toggle", async () => {
    const disableInstance = vi.fn().mockResolvedValue(undefined);
    seedStores(makeInstance(), { disableInstance });
    render(<RecipeInstanceRow instance={makeInstance({ enabled: true })} recipes={[RECIPE]} zoneId="z-salon" />);

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(toggle);
    expect(disableInstance).toHaveBeenCalledWith("ri-1");
  });

  it("enables a disabled instance from the toggle", async () => {
    const enableInstance = vi.fn().mockResolvedValue(undefined);
    seedStores(makeInstance({ enabled: false }), { enableInstance });
    render(<RecipeInstanceRow instance={makeInstance({ enabled: false })} recipes={[RECIPE]} zoneId="z-salon" />);

    await userEvent.click(screen.getByRole("switch"));
    expect(enableInstance).toHaveBeenCalledWith("ri-1");
  });

  it("opens the inline edit form pre-filled and gates Save on a change", async () => {
    seedStores(makeInstance());
    render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

    // The name is an "Edit" button for admins.
    await userEvent.click(screen.getByTitle("Edit"));

    // Edit form is open: slot labels and the Save/Cancel buttons appear.
    expect(screen.getByText("Delay")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" });
    // No change yet — Save is disabled.
    expect(save).toHaveProperty("disabled", true);

    // Change the delay; Save becomes enabled.
    const delay = screen.getByDisplayValue("5");
    await userEvent.clear(delay);
    await userEvent.type(delay, "9");
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  });

  it("opens recipe logs in a bottom sheet on the PWA/mobile (#615)", async () => {
    setViewport(true);
    const getLog = vi.fn().mockResolvedValue([LOG_ENTRY]);
    seedStores(makeInstance(), { getLog });
    render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

    // The log button is reachable on mobile (unlike duplicate/delete).
    await userEvent.click(screen.getByTitle("View log"));

    expect(await screen.findByText("Recipe fired")).toBeTruthy();
    expect(getLog).toHaveBeenCalledWith("ri-1");
    // Rendered in the bottom sheet: it carries a "View log" heading (the inline
    // desktop panel has none).
    expect(screen.getByRole("heading", { name: "View log" })).toBeTruthy();
  });

  it("opens recipe logs inline (no sheet) on desktop (#615)", async () => {
    setViewport(false);
    const getLog = vi.fn().mockResolvedValue([LOG_ENTRY]);
    seedStores(makeInstance(), { getLog });
    render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

    await userEvent.click(screen.getByTitle("View log"));

    expect(await screen.findByText("Recipe fired")).toBeTruthy();
    // Inline panel, not the bottom sheet — no sheet heading.
    expect(screen.queryByRole("heading", { name: "View log" })).toBeNull();
  });

  it("hides admin controls for a non-admin user", () => {
    seedStores(makeInstance());
    useAuth.setState({ user: { ...adminUser(), role: "standard" } });
    render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

    expect(screen.getByText("Auto light")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
  });
});
