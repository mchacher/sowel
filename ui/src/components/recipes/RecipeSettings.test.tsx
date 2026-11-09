import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, userEvent } from "../../test-utils";
import { RecipeSettings } from "./RecipeSettings";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import type { RecipeInfo, RecipeInstance } from "../../types";

// Spec 198, slice C — the settings window: a dialog on a computer, a page on a
// phone; the slot groups become sections, with a rail beyond two.

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

const WATCH: RecipeInfo = {
  id: "state-watch",
  name: "State watch",
  description: "",
  icon: "Eye",
  slots: [
    { id: "zone", name: "Zone", description: "", type: "zone", required: true },
    { id: "watchValue", name: "Watched value", description: "", type: "text", required: true },
    { id: "delay", name: "Delay", description: "", type: "number", required: false },
  ],
};

const VMC: RecipeInfo = {
  id: "vmc",
  name: "VMC",
  description: "",
  slots: [
    { id: "zone", name: "Zone", description: "", type: "zone", required: true },
    {
      id: "humidityMax",
      name: "Max humidity",
      description: "",
      type: "number",
      required: true,
      group: "thresholds",
    },
    {
      id: "outdoorMargin",
      name: "Outdoor margin",
      description: "",
      type: "number",
      required: true,
      group: "outdoor",
    },
    {
      id: "minRun",
      name: "Min run",
      description: "",
      type: "number",
      required: true,
      group: "limits",
    },
  ],
  i18n: {
    en: {
      groups: { thresholds: "Humidity thresholds", outdoor: "Outdoor air", limits: "Safeguards" },
    },
  } as unknown as RecipeInfo["i18n"],
};

function inst(recipeId: string, params: Record<string, unknown>): RecipeInstance {
  return {
    id: "ri-1",
    recipeId,
    params: { zone: "z", ...params },
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    state: {},
  };
}

function open(recipe: RecipeInfo, instance: RecipeInstance, onClose = vi.fn()) {
  render(
    <RecipeSettings
      instance={instance}
      recipe={recipe}
      zoneId="z"
      context="Poele, Erreur A01"
      alarm={false}
      onClose={onClose}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      deleting={false}
    />,
  );
  return onClose;
}

describe("RecipeSettings", () => {
  beforeEach(() => {
    setViewport(false);
    useZones.setState({ tree: [] });
    useEquipments.setState({ equipments: [] });
    useZoneAggregation.setState({ data: {} });
  });

  it("saves a change and closes", async () => {
    const updateInstance = vi.fn().mockResolvedValue(undefined);
    useRecipes.setState({ instances: [], updateInstance });
    const onClose = open(WATCH, inst("state-watch", { watchValue: "error_A01", delay: "1" }));

    expect(screen.getByRole("dialog", { name: "Settings of State watch" })).toBeTruthy();
    expect(screen.getByText("No change")).toBeTruthy();
    const delay = screen.getByDisplayValue("1");
    await userEvent.clear(delay);
    await userEvent.type(delay, "2");
    expect(screen.getByText("1 change")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateInstance).toHaveBeenCalledWith("ri-1", {
      zone: "z",
      watchValue: "error_A01",
      delay: "2",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape and on Cancel without saving", async () => {
    const updateInstance = vi.fn().mockResolvedValue(undefined);
    useRecipes.setState({ instances: [], updateInstance });
    const onClose = open(WATCH, inst("state-watch", { watchValue: "x" }));

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(updateInstance).not.toHaveBeenCalled();
  });

  it("takes focus on open and closes on a backdrop click, not on a press dragged out of it", async () => {
    useRecipes.setState({ instances: [], updateInstance: vi.fn() });
    const onClose = open(WATCH, inst("state-watch", { watchValue: "x" }));

    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    const backdrop = screen.getByTestId("recipe-settings-backdrop");
    // A text selection started in a field and released on the backdrop.
    fireEvent.mouseDown(screen.getByDisplayValue("x"));
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a refused save in the footer, beside the buttons", async () => {
    const updateInstance = vi.fn().mockResolvedValue(undefined);
    useRecipes.setState({ instances: [], updateInstance });
    // A required value left empty (a slot added by a newer recipe version).
    open(WATCH, inst("state-watch", { watchValue: "", delay: "1" }));

    const delay = screen.getByDisplayValue("1");
    await userEvent.clear(delay);
    await userEvent.type(delay, "2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert").textContent).toBe("Watched value is required");
    expect(updateInstance).not.toHaveBeenCalled();
  });

  it("lists the sections in a rail beyond two groups, none for one section", () => {
    useRecipes.setState({ instances: [], updateInstance: vi.fn() });
    open(VMC, inst("vmc", { humidityMax: "60", outdoorMargin: "3", minRun: "15" }));
    const rail = screen.getByRole("navigation", { name: "Setting groups" });
    expect(rail.textContent).toContain("Humidity thresholds");
    expect(rail.textContent).toContain("Outdoor air");
    expect(rail.textContent).toContain("Safeguards");
  });

  it("shows no rail for a recipe without groups, however many slots it has", () => {
    useRecipes.setState({ instances: [], updateInstance: vi.fn() });
    const many: RecipeInfo = {
      ...WATCH,
      slots: [
        ...WATCH.slots,
        { id: "checkStart", name: "Start", description: "", type: "text", required: false },
        { id: "checkEnd", name: "End", description: "", type: "text", required: false },
      ],
    };
    open(many, inst("state-watch", { watchValue: "x" }));
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeTruthy();
  });

  it("is a full-screen page on a phone, with a back button and no duplicate nor delete", async () => {
    setViewport(true);
    useRecipes.setState({ instances: [], updateInstance: vi.fn() });
    const onClose = open(WATCH, inst("state-watch", { watchValue: "x" }));

    expect(screen.getByRole("dialog", { name: "Settings of State watch" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalled();
  });
});
