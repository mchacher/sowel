import { describe, it, expect } from "vitest";
import type { RecipePublishDef } from "../shared/types.js";
import {
  RecipeOutputs,
  checkOutputValue,
  checkPublishDeclaration,
  recipeOutputBindingId,
} from "./recipe-outputs.js";

const STATE: RecipePublishDef = {
  slot: "equipment",
  alias: "state",
  type: "enum",
  category: "appliance_state",
  enumValues: ["off", "ready", "running", "finished"],
};
const NOW = "2026-11-21T10:00:00.000Z";

describe("checkOutputValue (spec 214)", () => {
  it("checks an enum against its values", () => {
    expect(checkOutputValue(STATE, "running")).toBeNull();
    expect(checkOutputValue(STATE, "spinning")).toContain("not one of");
  });

  it("checks numbers, booleans and text", () => {
    const n = { ...STATE, type: "number" as const };
    expect(checkOutputValue(n, 12.5)).toBeNull();
    expect(checkOutputValue(n, Number.NaN)).not.toBeNull();
    expect(checkOutputValue({ ...STATE, type: "boolean" }, "true")).not.toBeNull();
    expect(checkOutputValue({ ...STATE, type: "text" }, 3)).not.toBeNull();
  });

  it("always accepts null", () => {
    expect(checkOutputValue(STATE, null)).toBeNull();
  });
});

describe("checkPublishDeclaration", () => {
  const slots = new Set(["equipment"]);
  it("accepts a declaration on an equipment slot", () => {
    expect(checkPublishDeclaration([STATE], slots)).toBeNull();
  });
  it("refuses another slot, an enum without values, a duplicate", () => {
    expect(checkPublishDeclaration([{ ...STATE, slot: "delay" }], slots)).toContain("delay");
    expect(checkPublishDeclaration([{ ...STATE, enumValues: [] }], slots)).toContain("enumValues");
    expect(checkPublishDeclaration([STATE, STATE], slots)).toContain("twice");
  });
});

describe("RecipeOutputs", () => {
  it("attaches with a null value, and reports what it touched", () => {
    const outputs = new RecipeOutputs();
    expect(outputs.attach("i1", "Cycle", [{ equipmentId: "e1", def: STATE }])).toEqual(["e1"]);
    expect(outputs.get("e1", "state")).toMatchObject({ instanceId: "i1", value: null });
    expect(recipeOutputBindingId("i1", "state")).toBe("virtual:recipe:i1:state");
  });

  it("sets a value, and says whether it changed", () => {
    const outputs = new RecipeOutputs();
    outputs.attach("i1", "Cycle", [{ equipmentId: "e1", def: STATE }]);
    expect(outputs.set("i1", "e1", "state", "running", NOW)).toEqual({
      ok: true,
      changed: true,
      previous: null,
    });
    expect(outputs.set("i1", "e1", "state", "running", NOW)).toMatchObject({ changed: false });
  });

  it("refuses another instance, an undeclared alias, a wrong value", () => {
    const outputs = new RecipeOutputs();
    outputs.attach("i1", "Cycle", [{ equipmentId: "e1", def: STATE }]);
    expect(outputs.set("i2", "e1", "state", "running", NOW).ok).toBe(false);
    expect(outputs.set("i1", "e1", "phase", "wash", NOW).ok).toBe(false);
    expect(outputs.set("i1", "e2", "state", "running", NOW).ok).toBe(false);
    expect(outputs.set("i1", "e1", "state", "spinning", NOW).ok).toBe(false);
  });

  it("detaches every output of an instance", () => {
    const outputs = new RecipeOutputs();
    outputs.attach("i1", "Cycle", [
      { equipmentId: "e1", def: STATE },
      { equipmentId: "e2", def: STATE },
    ]);
    outputs.attach("i2", "Other", [{ equipmentId: "e3", def: STATE }]);
    expect(outputs.detach("i1").sort()).toEqual(["e1", "e2"]);
    expect(outputs.forEquipment("e1")).toEqual([]);
    expect(outputs.forEquipment("e3")).toHaveLength(1);
  });
});
