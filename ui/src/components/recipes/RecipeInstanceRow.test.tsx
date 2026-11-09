import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { RecipeInstanceRow } from "./RecipeInstanceRow";
import i18n from "../../i18n";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { useAuth } from "../../store/useAuth";
import type {
  RecipeInfo,
  RecipeInstance,
  EquipmentWithDetails,
  ZoneWithChildren,
  User,
} from "../../types";

// Component-test tier (issue #458). RecipeInstanceRow is the ~700-line row
// extracted from ZoneRecipesSection (#456). These pin the highest-value paths:
// the row shows the recipe name, the enable/disable toggle dispatches the
// matching store action, a click on the row opens its journal and « Settings »
// the edit form with the slots pre-filled and Save gated on an actual change,
// and non-admins get a read-only row (no toggle, no settings) (spec 198).

function zone(id: string, name: string, children: ZoneWithChildren[] = []): ZoneWithChildren {
  return {
    id,
    name,
    parentId: null,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    children,
  };
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
    {
      id: "light",
      name: "Light",
      description: "The light to drive",
      type: "equipment",
      required: true,
      constraints: { equipmentType: "light_onoff" },
    },
    {
      id: "delay",
      name: "Delay",
      description: "Minutes before off",
      type: "number",
      required: false,
    },
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

function seedStores(
  instance: RecipeInstance,
  overrides: Partial<Parameters<typeof useRecipes.setState>[0]> = {},
) {
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
    render(
      <RecipeInstanceRow
        instance={makeInstance({ enabled: true })}
        recipes={[RECIPE]}
        zoneId="z-salon"
      />,
    );

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(toggle);
    expect(disableInstance).toHaveBeenCalledWith("ri-1");
  });

  it("enables a disabled instance from the toggle", async () => {
    const enableInstance = vi.fn().mockResolvedValue(undefined);
    seedStores(makeInstance({ enabled: false }), { enableInstance });
    render(
      <RecipeInstanceRow
        instance={makeInstance({ enabled: false })}
        recipes={[RECIPE]}
        zoneId="z-salon"
      />,
    );

    await userEvent.click(screen.getByRole("switch"));
    expect(enableInstance).toHaveBeenCalledWith("ri-1");
  });

  /** The row itself: the button holding the recipe name. */
  const rowButton = () => screen.getByRole("button", { name: "Auto light" });

  it("opens the edit form from « Settings » in the journal, pre-filled, Save gated on a change", async () => {
    seedStores(makeInstance());
    render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

    await userEvent.click(rowButton());
    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));

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
    // Duplicate and delete moved into the form (spec 198).
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("opens recipe logs in a bottom sheet named after the recipe on the PWA/mobile (#615)", async () => {
    setViewport(true);
    const getLog = vi.fn().mockResolvedValue([LOG_ENTRY]);
    seedStores(makeInstance(), { getLog });
    render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

    await userEvent.click(rowButton());

    expect(await screen.findByText("Recipe fired")).toBeTruthy();
    expect(getLog).toHaveBeenCalledWith("ri-1");
    expect(screen.getByRole("heading", { name: "Auto light" })).toBeTruthy();
  });

  it("opens recipe logs inline (no sheet) on desktop, closes on a second click (#615)", async () => {
    setViewport(false);
    const getLog = vi.fn().mockResolvedValue([LOG_ENTRY]);
    seedStores(makeInstance(), { getLog });
    render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

    await userEvent.click(rowButton());

    expect(await screen.findByText("Recipe fired")).toBeTruthy();
    expect(rowButton().getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("heading", { name: "Auto light" })).toBeNull();

    await userEvent.click(rowButton());
    expect(screen.queryByText("Recipe fired")).toBeNull();
  });

  describe("the clickable row (spec 198)", () => {
    it("toggles from the switch without opening the journal", async () => {
      const getLog = vi.fn().mockResolvedValue([]);
      const disableInstance = vi.fn().mockResolvedValue(undefined);
      seedStores(makeInstance(), { getLog, disableInstance });
      render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

      await userEvent.click(screen.getByRole("switch"));
      expect(disableInstance).toHaveBeenCalledWith("ri-1");
      expect(getLog).not.toHaveBeenCalled();
      expect(rowButton().getAttribute("aria-expanded")).toBe("false");
    });

    it("opens the journal from the keyboard", async () => {
      const getLog = vi.fn().mockResolvedValue([LOG_ENTRY]);
      seedStores(makeInstance(), { getLog });
      render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

      rowButton().focus();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByText("Recipe fired")).toBeTruthy();
    });

    it("lets a standard user read the journal, with no switch and no « Settings »", async () => {
      const getLog = vi.fn().mockResolvedValue([LOG_ENTRY]);
      seedStores(makeInstance(), { getLog });
      useAuth.setState({ user: { ...adminUser(), role: "standard" } });
      render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

      await userEvent.click(rowButton());
      expect(await screen.findByText("Recipe fired")).toBeTruthy();
      expect(screen.queryByRole("switch")).toBeNull();
      expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    });

    it("flags an instance in alarm: a dot on the icon and the line in red", () => {
      const inst = makeInstance({ state: { alarm: true, summary: "Erreur A02 en alarme" } });
      seedStores(inst);
      render(<RecipeInstanceRow instance={inst} recipes={[RECIPE]} zoneId="z-salon" />);

      expect(screen.getByRole("img", { name: "In alarm" })).toBeTruthy();
      const line = screen.getByTitle("Ceiling light, Erreur A02 en alarme");
      expect(line.closest(".text-error")).not.toBeNull();
    });

    it("shows no alarm on a disabled instance", () => {
      const inst = makeInstance({ enabled: false, state: { alarm: true } });
      seedStores(inst);
      render(<RecipeInstanceRow instance={inst} recipes={[RECIPE]} zoneId="z-salon" />);

      expect(screen.queryByRole("img", { name: "In alarm" })).toBeNull();
    });

    it("leaves the row closed when a mode pill is clicked", async () => {
      const getLog = vi.fn().mockResolvedValue([]);
      const sendAction = vi.fn().mockResolvedValue(undefined);
      const inst = makeInstance({ state: { mode: "comfort" } });
      seedStores(inst, { getLog, sendAction });
      const cycle: RecipeInfo = {
        ...RECIPE,
        actions: [
          {
            id: "setMode",
            type: "cycle",
            stateKey: "mode",
            options: [
              { value: "eco", label: "Eco" },
              { value: "comfort", label: "Comfort" },
            ],
          },
        ],
      };
      render(<RecipeInstanceRow instance={inst} recipes={[cycle]} zoneId="z-salon" />);

      await userEvent.click(screen.getByRole("button", { name: "Comfort" }));
      expect(sendAction).toHaveBeenCalledWith("ri-1", "setMode", { mode: "eco" });
      expect(getLog).not.toHaveBeenCalled();
    });

    it("toggles from the keyboard on the switch without opening the row", async () => {
      const getLog = vi.fn().mockResolvedValue([]);
      const disableInstance = vi.fn().mockResolvedValue(undefined);
      seedStores(makeInstance(), { getLog, disableInstance });
      render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

      screen.getByRole("switch").focus();
      await userEvent.keyboard("{Enter}");
      expect(disableInstance).toHaveBeenCalledWith("ri-1");
      expect(getLog).not.toHaveBeenCalled();
    });

    it("closes the edit form when the journal is opened again", async () => {
      seedStores(makeInstance());
      render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

      await userEvent.click(rowButton());
      await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      await userEvent.click(rowButton());
      await screen.findByRole("button", { name: "Settings" });
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });

    it("renders a group child as one line, the recipe name left to the group", () => {
      const inst = makeInstance({ state: { summary: "Erreur A01 après 1 min" } });
      seedStores(inst);
      render(
        <RecipeInstanceRow instance={inst} recipes={[RECIPE]} zoneId="z-salon" variant="child" />,
      );

      expect(screen.queryByText("Auto light")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Ceiling light, Erreur A01 après 1 min" }),
      ).toBeTruthy();
      expect(screen.getByRole("switch")).toBeTruthy();
    });
  });

  describe("live pills on the second line (#1161)", () => {
    const CYCLE_RECIPE: RecipeInfo = {
      ...RECIPE,
      actions: [
        {
          id: "setMode",
          type: "cycle",
          stateKey: "mode",
          options: [
            { value: "eco", label: "Eco" },
            { value: "comfort", label: "Comfort" },
          ],
        },
      ],
    };
    const inFuture = new Date(Date.now() + 14 * 60_000 + 30_000).toISOString();
    const withPills = (): RecipeInstance =>
      makeInstance({ state: { mode: "comfort", timerExpiresAt: inFuture, overrideMode: true } });

    function rows(): { row1: HTMLElement; row2: HTMLElement | null } {
      const name = screen.getByText("Auto light");
      const row1 = name.closest(".row-start-1") as HTMLElement;
      const row2 = row1.parentElement!.querySelector<HTMLElement>(":scope > .row-start-2");
      return { row1, row2 };
    }

    it("puts the countdown, override and mode pills on row 2, never beside the name", () => {
      seedStores(withPills());
      render(
        <RecipeInstanceRow instance={withPills()} recipes={[CYCLE_RECIPE]} zoneId="z-salon" />,
      );

      const { row1, row2 } = rows();
      const mode = screen.getByRole("button", { name: "Comfort" });
      const override = screen.getByTitle("Override active");
      const countdown = screen.getByText(/14\s*min/);

      for (const pill of [mode, override, countdown]) {
        expect(row1.contains(pill)).toBe(false);
        expect(row2?.contains(pill)).toBe(true);
      }
    });

    it("gives a non-admin a second line holding a working mode pill", async () => {
      const sendAction = vi.fn().mockResolvedValue(undefined);
      seedStores(withPills(), { sendAction });
      useAuth.setState({ user: { ...adminUser(), role: "standard" } });
      render(
        <RecipeInstanceRow instance={withPills()} recipes={[CYCLE_RECIPE]} zoneId="z-salon" />,
      );

      expect(rows().row2).not.toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Comfort" }));
      expect(sendAction).toHaveBeenCalledWith("ri-1", "setMode", { mode: "eco" });
    });

    it("shows no pill when the cycle resolves to nothing", () => {
      seedStores(makeInstance());
      useAuth.setState({ user: { ...adminUser(), role: "standard" } });
      render(
        <RecipeInstanceRow instance={makeInstance()} recipes={[CYCLE_RECIPE]} zoneId="z-salon" />,
      );

      // No mode in state → the cycle resolves to nothing: line 2 holds the equipment only.
      expect(screen.queryByRole("button", { name: /Eco|Comfort/ })).toBeNull();
      expect(rows().row2?.textContent).toBe("Ceiling light");
    });

    it("shows no pill on a disabled instance", () => {
      const off = makeInstance({ ...withPills(), enabled: false });
      seedStores(off);
      render(<RecipeInstanceRow instance={off} recipes={[CYCLE_RECIPE]} zoneId="z-salon" />);

      expect(screen.queryByRole("button", { name: "Comfort" })).toBeNull();
      expect(screen.queryByTitle("Override active")).toBeNull();
    });

    it("reads the override badge and the settings button in French (#1169)", async () => {
      await i18n.changeLanguage("fr");
      try {
        seedStores(withPills());
        render(
          <RecipeInstanceRow instance={withPills()} recipes={[CYCLE_RECIPE]} zoneId="z-salon" />,
        );

        expect(screen.getByTitle("Dérogation active").textContent).toBe("Dérogation");
        expect(screen.queryByText("Override")).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Auto light" }));
        expect(await screen.findByRole("button", { name: "Réglages" })).toBeTruthy();
      } finally {
        await i18n.changeLanguage("en");
      }
    });
  });

  describe("the equipment an instance acts on (#1165)", () => {
    const LIST_RECIPE: RecipeInfo = {
      id: "r-list",
      name: "Motion light",
      description: "",
      slots: [
        { id: "zone", name: "Zone", description: "", type: "zone", required: true },
        {
          id: "lights",
          name: "Lights",
          description: "",
          type: "equipment",
          required: true,
          list: true,
        },
        {
          id: "buttons",
          name: "Buttons",
          description: "",
          type: "equipment",
          required: false,
          list: true,
        },
      ],
    };
    const NO_EQ_RECIPE: RecipeInfo = {
      id: "r-none",
      name: "Freecooling",
      description: "",
      slots: [{ id: "zone", name: "Zone", description: "", type: "zone", required: true }],
    };
    const lamps = ["Spot A", "Spot B", "Spot C", "Spot D"].map((name, i) =>
      equipment({ id: `l-${i}`, name }),
    );

    it("names the equipment of the first equipment slot under the recipe name", () => {
      seedStores(makeInstance());
      render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

      const line = screen.getByText("Ceiling light");
      // In the row, under the name.
      const name = screen.getByText("Auto light");
      expect(name.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(name.closest(".grid")?.contains(line)).toBe(true);
    });

    it("reads a long list as « A, B +2 », the full list on hover", () => {
      const inst = makeInstance({
        recipeId: "r-list",
        params: { zone: "z-salon", lights: lamps.map((l) => l.id), buttons: ["eq-1"] },
      });
      seedStores(inst);
      useEquipments.setState({ equipments: [equipment(), ...lamps] });
      render(<RecipeInstanceRow instance={inst} recipes={[LIST_RECIPE]} zoneId="z-salon" />);

      const names = screen.getByText("Spot A, Spot B");
      // The count has its own span: the names truncate, never the count.
      expect(screen.getByText("+2")).toBeTruthy();
      expect(names.parentElement?.getAttribute("title")).toBe("Spot A, Spot B, Spot C, Spot D");
      // The buttons slot is not the first equipment slot: not listed.
      expect(screen.queryByText(/Ceiling light/)).toBeNull();
    });

    it("shows nothing extra for a recipe without an equipment slot", () => {
      const inst = makeInstance({ recipeId: "r-none", params: { zone: "z-salon" } });
      seedStores(inst);
      const { container } = render(
        <RecipeInstanceRow instance={inst} recipes={[NO_EQ_RECIPE]} zoneId="z-salon" />,
      );

      const block = screen.getByText("Freecooling").parentElement!;
      expect(block.children).toHaveLength(1);
      expect(container.textContent).not.toContain("Ceiling light");
    });

    it("still shows the equipment of a disabled instance", () => {
      const off = makeInstance({ enabled: false });
      seedStores(off);
      render(<RecipeInstanceRow instance={off} recipes={[RECIPE]} zoneId="z-salon" />);

      expect(screen.getByText("Ceiling light")).toBeTruthy();
    });

    it("puts the recipe summary after the equipment, joined by a comma (spec 198)", () => {
      const inst = makeInstance({ state: { summary: "Filtration 2,1 h" } });
      seedStores(inst);
      render(<RecipeInstanceRow instance={inst} recipes={[RECIPE]} zoneId="z-salon" />);

      const line = screen.getByTitle("Ceiling light, Filtration 2,1 h");
      expect(line.textContent).not.toContain("\u00b7");
    });
  });

  it("hides admin controls for a non-admin user", () => {
    seedStores(makeInstance());
    useAuth.setState({ user: { ...adminUser(), role: "standard" } });
    render(<RecipeInstanceRow instance={makeInstance()} recipes={[RECIPE]} zoneId="z-salon" />);

    expect(screen.getByText("Auto light")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });
});
