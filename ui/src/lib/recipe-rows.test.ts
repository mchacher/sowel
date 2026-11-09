import { describe, expect, it } from "vitest";
import type { RecipeInstance } from "../types";
import {
  groupZoneInstances,
  instanceContextLine,
  instanceSummary,
  isInstanceInAlarm,
} from "./recipe-rows";

// Spec 198 — the recipe rows of a zone.

function inst(id: string, recipeId: string, over: Partial<RecipeInstance> = {}): RecipeInstance {
  return {
    id,
    recipeId,
    params: { zone: "z" },
    enabled: true,
    createdAt: "2026-11-01T00:00:00Z",
    ...over,
  } as RecipeInstance;
}

describe("groupZoneInstances", () => {
  it("groups the instances of one recipe at the place of the first one", () => {
    const blocks = groupZoneInstances([
      inst("1", "A"),
      inst("2", "B"),
      inst("3", "A"),
      inst("4", "C"),
    ]);
    expect(
      blocks.map((b) => (b.kind === "group" ? `g:${b.recipeId}` : `s:${b.instance.id}`)),
    ).toEqual(["g:A", "s:2", "s:4"]);
    const group = blocks[0];
    expect(group.kind === "group" && group.instances.map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("keeps different recipes as single rows", () => {
    const blocks = groupZoneInstances([inst("1", "A"), inst("2", "B")]);
    expect(blocks.every((b) => b.kind === "single")).toBe(true);
  });

  it("returns nothing for no instance", () => {
    expect(groupZoneInstances([])).toEqual([]);
  });
});

describe("isInstanceInAlarm", () => {
  it("is true only for an enabled instance publishing alarm = true", () => {
    expect(isInstanceInAlarm(inst("1", "A", { state: { alarm: true } }))).toBe(true);
    expect(isInstanceInAlarm(inst("1", "A", { state: { alarm: false } }))).toBe(false);
    expect(isInstanceInAlarm(inst("1", "A", { state: { alarm: "true" } }))).toBe(false);
    expect(isInstanceInAlarm(inst("1", "A"))).toBe(false);
    expect(isInstanceInAlarm(inst("1", "A", { enabled: false, state: { alarm: true } }))).toBe(
      false,
    );
  });
});

describe("instanceContextLine", () => {
  it("joins equipment and summary with a comma", () => {
    expect(instanceContextLine("Poele", "Erreur A01 après 1 min")).toBe(
      "Poele, Erreur A01 après 1 min",
    );
    expect(instanceContextLine("Poele", "")).toBe("Poele");
    expect(instanceContextLine("", "Erreur A01")).toBe("Erreur A01");
    expect(instanceContextLine(" ", " ")).toBe("");
  });

  it("never writes a middle dot", () => {
    for (const [a, b] of [
      ["Poele", "x"],
      ["Spot A, Spot B +2", "Confort 22°"],
      ["", "y"],
    ]) {
      expect(instanceContextLine(a, b)).not.toContain("\u00b7");
    }
  });
});

describe("instanceSummary", () => {
  it("reads state.summary when it is a string", () => {
    expect(instanceSummary(inst("1", "A", { state: { summary: "Filtration 2 h" } }))).toBe(
      "Filtration 2 h",
    );
    expect(instanceSummary(inst("1", "A", { state: { summary: 3 } }))).toBe("");
    expect(instanceSummary(inst("1", "A"))).toBe("");
  });
});
