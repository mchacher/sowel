/**
 * Spec 169 — what the tile shows is what the recipe declared, and nothing else.
 *
 * The store is seeded directly (as the arbiter tests do) so no network call
 * decides what renders; every case here is about the mapping from a `tile`
 * declaration plus an instance state to pixels.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
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
  actions?: RecipeInfo["actions"];
} = {}) {
  const recipe: RecipeInfo = {
    id: "delivery-gate",
    name: "Delivery Gate",
    description: "",
    slots: [],
    actions: options.actions ?? [ACTION],
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

/**
 * Spec 171 — the card acts, not just the pill.
 *
 * The tile is a 240 px square whose own summary line says a click opens the
 * gate; until this spec the only thing that did was a 10 px pill. These pin
 * both halves of the rule: the card fires the single control it shows, and it
 * fires nothing whenever there is no single control to speak for.
 */
describe("RecipeTile — the whole card acts (spec 171)", () => {
  const SECOND_ACTION = {
    id: "set_speed",
    type: "cycle" as const,
    stateKey: "speed",
    options: [
      { value: "low", label: "Lent" },
      { value: "high", label: "Rapide" },
    ],
  };

  /** The title span: inside the card, outside every control. */
  const cardBody = () => screen.getByText("Delivery Gate");

  let sendAction: Mock<
    (instanceId: string, action: string, payload?: Record<string, unknown>) => Promise<void>
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T14:00:00Z"));
    sendAction = vi.fn(async () => {});
    useRecipes.setState({ instances: [], recipes: [], sendAction });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the tile's single control when the card is clicked", () => {
    seed({ tile: FULL_TILE, state: { mode: "idle" } });
    render(<RecipeTile widget={WIDGET} />);

    fireEvent.click(cardBody());

    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith("ri1", "set_mode", { mode: "short" });
  });

  it("fires once, not twice, when the pill itself is clicked", () => {
    seed({ tile: FULL_TILE, state: { mode: "idle" } });
    render(<RecipeTile widget={WIDGET} />);

    fireEvent.click(screen.getByRole("button", { name: /Repos/ }));

    // The card is the pill's ancestor: without the nested-control guard this
    // click would send the action twice.
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  it("stays inert when the tile shows two controls", () => {
    seed({
      tile: { actions: ["set_mode", "set_speed"] },
      actions: [ACTION, SECOND_ACTION],
      state: { mode: "idle", speed: "low" },
    });
    render(<RecipeTile widget={WIDGET} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);

    fireEvent.click(cardBody());

    // Which of the two would it have fired?
    expect(sendAction).not.toHaveBeenCalled();
  });

  it("stays inert when the state carries no position to cycle", () => {
    seed({ tile: FULL_TILE, state: { summary: "Rien à faire" } });
    render(<RecipeTile widget={WIDGET} />);

    fireEvent.click(cardBody());

    expect(sendAction).not.toHaveBeenCalled();
  });

  it("stays inert on a disabled instance", () => {
    seed({ tile: FULL_TILE, enabled: false, state: { mode: "idle" } });
    render(<RecipeTile widget={WIDGET} />);

    fireEvent.click(cardBody());

    expect(sendAction).not.toHaveBeenCalled();
  });

  it("stays inert in edit mode, on both surfaces", () => {
    seed({ tile: FULL_TILE, state: { mode: "idle" } });
    const { rerender } = render(<RecipeTile widget={WIDGET} editMode />);
    fireEvent.click(cardBody());

    rerender(<RecipeTile widget={WIDGET} editMode isMobile />);
    fireEvent.click(cardBody());

    // A Dashboard being rearranged is not a Dashboard being used.
    expect(sendAction).not.toHaveBeenCalled();
  });

  it("drops a second click while the first action is still in flight", () => {
    sendAction.mockImplementation(() => new Promise<void>(() => {}));
    seed({ tile: FULL_TILE, state: { mode: "idle" } });
    render(<RecipeTile widget={WIDGET} />);

    fireEvent.click(cardBody());
    fireEvent.click(cardBody());

    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  describe("with tile.confirm", () => {
    const CONFIRM_TILE = { icon: "Truck", actions: ["set_mode"], confirm: true };
    let widthSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // jsdom lays nothing out; the slide track needs a width to have a travel.
      widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(260);
    });
    afterEach(() => widthSpy.mockRestore());

    /** Drag the knob the full travel of a 260 px track. */
    function slide() {
      const knob = screen.getByRole("button", { name: "Slide to confirm" });
      fireEvent.pointerDown(knob, { pointerId: 1, clientX: 0 });
      fireEvent.pointerMove(knob, { pointerId: 1, clientX: 260 - 58 });
    }

    it("asks before it acts, on mobile", () => {
      seed({ tile: CONFIRM_TILE, state: { mode: "idle", summary: "Prêt" } });
      render(<RecipeTile widget={WIDGET} isMobile />);

      fireEvent.click(cardBody());

      // The sheet names the position the tap is about to switch to.
      expect(screen.getByText("Switch to “Livreur”?")).toBeTruthy();
      expect(screen.getByText("Delivery Gate · Prêt")).toBeTruthy();
      expect(sendAction).not.toHaveBeenCalled();

      slide();
      expect(sendAction).toHaveBeenCalledWith("ri1", "set_mode", { mode: "short" });
    });

    it("sends nothing when the sheet is dismissed", () => {
      seed({ tile: CONFIRM_TILE, state: { mode: "idle" } });
      render(<RecipeTile widget={WIDGET} isMobile />);

      fireEvent.click(cardBody());
      fireEvent.click(screen.getByText("Cancel"));

      expect(screen.queryByText("Switch to “Livreur”?")).toBeNull();
      expect(sendAction).not.toHaveBeenCalled();
    });

    it("acts directly on desktop — a mouse click is deliberate", () => {
      seed({ tile: CONFIRM_TILE, state: { mode: "idle" } });
      render(<RecipeTile widget={WIDGET} />);

      fireEvent.click(cardBody());

      expect(screen.queryByText("Switch to “Livreur”?")).toBeNull();
      expect(sendAction).toHaveBeenCalledWith("ri1", "set_mode", { mode: "short" });
    });
  });
});
