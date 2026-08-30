/**
 * Spec 169 — what the tile shows is what the recipe declared, and nothing else.
 *
 * The store is seeded directly (as the arbiter tests do) so no network call
 * decides what renders; every case here is about the mapping from a `tile`
 * declaration plus an instance state to pixels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "../../test-utils";
import { RecipeTile } from "./RecipeTile";
import { useRecipes } from "../../store/useRecipes";
import type { DashboardWidget, RecipeInfo, RecipeInstance } from "../../types";

const WIDGET: DashboardWidget = {
  id: "w1",
  type: "recipe",
  recipeInstanceId: "ri1",
  displayOrder: 0,
  createdAt: "2026-08-30T10:00:00Z",
};

const ACTION = {
  id: "set_mode",
  type: "cycle" as const,
  stateKey: "mode",
  options: [
    { value: "idle", label: "Repos" },
    { value: "short", label: "Livreur" },
  ],
};

function seed(options: {
  tile?: RecipeInfo["tile"];
  state?: Record<string, unknown>;
  enabled?: boolean;
  recipe?: boolean;
} = {}) {
  const recipe: RecipeInfo = {
    id: "delivery-gate",
    name: "Delivery Gate",
    description: "",
    slots: [],
    actions: [ACTION],
    ...(options.tile ? { tile: options.tile } : {}),
  };
  const instance: RecipeInstance = {
    id: "ri1",
    recipeId: "delivery-gate",
    params: {},
    enabled: options.enabled ?? true,
    createdAt: "2026-08-30T10:00:00Z",
    state: options.state ?? {},
  };
  useRecipes.setState({
    instances: [instance],
    recipes: options.recipe === false ? [] : [recipe],
  });
}

const FULL_TILE = { icon: "Truck", actions: ["set_mode"] };

describe("RecipeTile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T14:00:00Z"));
    useRecipes.setState({ instances: [], recipes: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the summary, the countdown and the declared control", () => {
    seed({
      tile: FULL_TILE,
      state: {
        summary: "Ouvert pour le livreur",
        timerExpiresAt: new Date("2026-08-30T14:12:00Z").toISOString(),
        mode: "short",
      },
    });
    render(<RecipeTile widget={WIDGET} />);

    expect(screen.getByText("Delivery Gate")).toBeTruthy();
    expect(screen.getByText("Ouvert pour le livreur")).toBeTruthy();
    expect(screen.getByText("12m")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Livreur/ })).toBeTruthy();
  });

  it("shows icon and title alone when the state carries nothing", () => {
    seed({ tile: FULL_TILE, state: {} });
    render(<RecipeTile widget={WIDGET} />);

    expect(screen.getByText("Delivery Gate")).toBeTruthy();
    // No pill: ModeCyclePill needs the state key its action names.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("omits a countdown whose deadline has passed", () => {
    seed({
      tile: FULL_TILE,
      state: { timerExpiresAt: new Date("2026-08-30T13:00:00Z").toISOString(), mode: "short" },
    });
    render(<RecipeTile widget={WIDGET} />);

    expect(screen.queryByText(/\d+m/)).toBeNull();
  });

  it("reads the keys the recipe named, not the defaults", () => {
    seed({
      tile: { summaryKey: "headline", countdownKey: "until" },
      state: {
        headline: "Depuis la clé déclarée",
        summary: "Cette ligne ne doit pas s'afficher",
        until: new Date("2026-08-30T14:05:00Z").toISOString(),
      },
    });
    render(<RecipeTile widget={WIDGET} />);

    expect(screen.getByText("Depuis la clé déclarée")).toBeTruthy();
    expect(screen.queryByText("Cette ligne ne doit pas s'afficher")).toBeNull();
    expect(screen.getByText("5m")).toBeTruthy();
  });

  it("skips a control the recipe does not actually declare", () => {
    seed({ tile: { actions: ["set_mode", "ghost"] }, state: { mode: "short" } });
    render(<RecipeTile widget={WIDGET} />);

    // One pill, not two: the unknown id costs a button, not the tile.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("greys a disabled instance and drops its controls", () => {
    seed({
      tile: FULL_TILE,
      enabled: false,
      state: { mode: "short", timerExpiresAt: new Date("2026-08-30T14:12:00Z").toISOString() },
    });
    render(<RecipeTile widget={WIDGET} />);

    expect(screen.getByText("Delivery Gate")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("12m")).toBeNull();
  });

  it("says so when the recipe no longer declares a tile", () => {
    seed({ state: { summary: "ignored" } }); // recipe present, tile absent
    render(<RecipeTile widget={WIDGET} />);

    expect(screen.getByText("This recipe no longer offers a tile")).toBeTruthy();
    expect(screen.queryByText("ignored")).toBeNull();
  });

  it("survives a recipe that is gone from the store", () => {
    seed({ tile: FULL_TILE, recipe: false });
    render(<RecipeTile widget={WIDGET} />);

    expect(screen.getByText("This recipe no longer offers a tile")).toBeTruthy();
  });

  it("cycles the mode through the store when a control is clicked", async () => {
    const sendAction = vi.fn().mockResolvedValue(undefined);
    seed({ tile: FULL_TILE, state: { mode: "idle" } });
    useRecipes.setState({ sendAction });
    render(<RecipeTile widget={WIDGET} />);

    fireEvent.click(screen.getByRole("button", { name: /Repos/ }));

    // The pill shows the CURRENT position and sends the NEXT one.
    expect(sendAction).toHaveBeenCalledWith("ri1", "set_mode", { mode: "short" });
  });

  it("ticks the countdown down as time passes", () => {
    seed({
      tile: FULL_TILE,
      state: { timerExpiresAt: new Date("2026-08-30T14:10:00Z").toISOString() },
    });
    render(<RecipeTile widget={WIDGET} />);
    expect(screen.getByText("10m")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(screen.getByText("5m")).toBeTruthy();

    // Past the deadline it disappears rather than showing a negative time.
    act(() => {
      vi.advanceTimersByTime(6 * 60_000);
    });
    expect(screen.queryByText(/\d+m/)).toBeNull();
  });

  it("prefers the user's own label over the recipe name", () => {
    seed({ tile: FULL_TILE, state: {} });
    render(<RecipeTile widget={{ ...WIDGET, label: "Portail livreur" }} />);

    expect(screen.getByText("Portail livreur")).toBeTruthy();
    expect(screen.queryByText("Delivery Gate")).toBeNull();
  });
});
