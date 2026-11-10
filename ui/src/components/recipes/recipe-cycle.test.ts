import { describe, expect, it } from "vitest";
import type { RecipeActionDef, RecipeInstance } from "../../types";
import { resolveCycle } from "./recipe-cycle";

// #1210 — which options a cycle offers is declared by the recipe
// (`requiresParam`); the core knows no recipe parameter by name.

const action: RecipeActionDef = {
  id: "set_mode",
  type: "cycle",
  stateKey: "mode",
  options: [
    { value: "eco", label: "Eco" },
    { value: "comfort", label: "Comfort" },
    { value: "boost", label: "Boost", requiresParam: "boostTemp" },
  ],
};

function inst(params: Record<string, unknown>, state = { mode: "eco" }): RecipeInstance {
  return {
    id: "i1",
    recipeId: "r",
    params,
    enabled: true,
    createdAt: "2026-11-01T00:00:00Z",
    state,
  };
}

const offered = (params: Record<string, unknown>) =>
  resolveCycle(inst(params), action)?.options.map((o) => o.value);

describe("resolveCycle", () => {
  it("offers an option whose required parameter is set", () => {
    expect(offered({ boostTemp: 24 })).toEqual(["eco", "comfort", "boost"]);
    expect(offered({ boostTemp: "0" })).toEqual(["eco", "comfort", "boost"]);
  });

  it("hides it while the parameter is absent, null or empty", () => {
    expect(offered({})).toEqual(["eco", "comfort"]);
    expect(offered({ boostTemp: null })).toEqual(["eco", "comfort"]);
    expect(offered({ boostTemp: "" })).toEqual(["eco", "comfort"]);
  });

  it("filters nothing by name: cocoon and night without requiresParam stay offered", () => {
    const named: RecipeActionDef = {
      ...action,
      options: [
        { value: "cocoon", label: "Cocoon" },
        { value: "night", label: "Night" },
      ],
    };
    const cycle = resolveCycle(inst({}, { mode: "cocoon" }), named);
    expect(cycle?.options.map((o) => o.value)).toEqual(["cocoon", "night"]);
    expect(cycle?.next.value).toBe("night");
  });

  it("returns null when fewer than two options are left", () => {
    const one: RecipeActionDef = {
      ...action,
      options: [
        { value: "eco", label: "Eco" },
        { value: "boost", label: "Boost", requiresParam: "boostTemp" },
      ],
    };
    expect(resolveCycle(inst({}), one)).toBeNull();
  });
});
