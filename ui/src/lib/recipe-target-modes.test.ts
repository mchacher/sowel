import { describe, expect, it } from "vitest";
import type { RecipeActionDef, RecipeInfo, RecipeInstance } from "../types";
import { modesForEquipment } from "./recipe-target-modes";

// Spec 201 — the modes shown on an equipment's Dashboard card.

const OPTIONS = [
  { value: "comfort", label: "Comfort" },
  { value: "eco", label: "Eco" },
  { value: "cocoon", label: "Cocoon" },
];

function recipe(id: string, action: Partial<RecipeActionDef> = {}): RecipeInfo {
  return {
    id,
    name: id,
    description: "",
    slots: [
      { id: "thermostat", name: "", description: "", type: "equipment", required: true },
      { id: "heaters", name: "", description: "", type: "equipment", required: false, list: true },
      { id: "buttons", name: "", description: "", type: "equipment", required: false, list: true },
      { id: "zone", name: "", description: "", type: "zone", required: true },
    ],
    actions: [
      {
        id: "set_mode",
        type: "cycle",
        stateKey: "currentMode",
        options: OPTIONS,
        targets: ["thermostat"],
        ...action,
      },
    ],
  };
}

function inst(id: string, over: Partial<RecipeInstance> = {}): RecipeInstance {
  return {
    id,
    recipeId: "presence-thermostat",
    params: { zone: "z-1", thermostat: "poele", buttons: ["switch-cocoon"] },
    enabled: true,
    createdAt: "2026-11-01T00:00:00Z",
    state: { currentMode: "cocoon" },
    ...over,
  };
}

const PT = recipe("presence-thermostat");
const labels = (eq: string, instances: RecipeInstance[], recipes: RecipeInfo[] = [PT]) =>
  modesForEquipment(eq, instances, recipes).map((m) => m.option.label);

describe("modesForEquipment", () => {
  it("shows the mode on the equipment held by the target slot", () => {
    const modes = modesForEquipment("poele", [inst("i1")], [PT]);
    expect(modes).toHaveLength(1);
    expect(modes[0].option).toEqual({ value: "cocoon", label: "Cocoon" });
    expect(modes[0].key).toBe("i1:set_mode");
  });

  it("matches an equipment inside a list target slot", () => {
    const r = recipe("smart-socket-heating", { targets: ["heaters"] });
    const i = inst("i1", {
      recipeId: "smart-socket-heating",
      params: { heaters: ["rad-1", "rad-2"] },
    });
    expect(labels("rad-2", [i], [r])).toEqual(["Cocoon"]);
  });

  it("shows nothing on an equipment the recipe only reads (the cocoon buttons)", () => {
    expect(labels("switch-cocoon", [inst("i1")])).toEqual([]);
  });

  it("shows nothing when the action declares no targets", () => {
    const r = recipe("presence-thermostat", { targets: undefined });
    expect(labels("poele", [inst("i1")], [r])).toEqual([]);
  });

  it("ignores a target that names an unknown or non-equipment slot", () => {
    const r = recipe("presence-thermostat", { targets: ["zone", "missing"] });
    const i = inst("i1", { params: { zone: "poele", missing: "poele" } });
    expect(labels("poele", [i], [r])).toEqual([]);
  });

  it("shows nothing for a disabled instance", () => {
    expect(labels("poele", [inst("i1", { enabled: false })])).toEqual([]);
  });

  it("shows nothing while the state value is absent or outside the options", () => {
    expect(labels("poele", [inst("i1", { state: {} })])).toEqual([]);
    expect(labels("poele", [inst("i1", { state: { currentMode: "override" } })])).toEqual([]);
  });

  it("shows one pill when the equipment sits in two target slots of one instance", () => {
    const r = recipe("presence-thermostat", { targets: ["thermostat", "heaters"] });
    const i = inst("i1", { params: { thermostat: "poele", heaters: ["poele"] } });
    expect(labels("poele", [i], [r])).toEqual(["Cocoon"]);
  });

  it("shows one pill per instance, oldest first", () => {
    const newer = inst("i2", { createdAt: "2026-11-05T00:00:00Z", state: { currentMode: "eco" } });
    const older = inst("i1", { createdAt: "2026-11-01T00:00:00Z" });
    expect(labels("poele", [newer, older])).toEqual(["Cocoon", "Eco"]);
  });

  it("shows nothing when the recipe definition is gone", () => {
    expect(labels("poele", [inst("i1")], [])).toEqual([]);
  });
});
