import { describe, it, expect } from "vitest";
import { groupModes, modeGroupNames } from "./mode-groups";
import type { Mode } from "../types";

const mode = (name: string, group?: string): Mode => ({
  id: name,
  name,
  group,
  active: false,
  createdAt: "",
  updatedAt: "",
});

describe("groupModes", () => {
  it("puts everything in others when no mode has a group", () => {
    const modes = [mode("Night"), mode("Guests")];
    expect(groupModes(modes)).toEqual({ groups: [], others: modes });
  });

  it("splits grouped and ungrouped modes, keeping their order", () => {
    const r = groupModes([mode("Away", "Presence"), mode("Night"), mode("Home", "Presence")]);
    expect(r.groups).toEqual([
      { name: "Presence", modes: [mode("Away", "Presence"), mode("Home", "Presence")] },
    ]);
    expect(r.others.map((m) => m.name)).toEqual(["Night"]);
  });

  it("sorts several groups by name", () => {
    const r = groupModes([mode("Home", "Presence"), mode("Comfort", "Heating")]);
    expect(r.groups.map((g) => g.name)).toEqual(["Heating", "Presence"]);
  });
});

describe("modeGroupNames", () => {
  it("lists distinct names, sorted", () => {
    expect(
      modeGroupNames([
        mode("A", "Presence"),
        mode("B", "Heating"),
        mode("C", "Presence"),
        mode("D"),
      ]),
    ).toEqual(["Heating", "Presence"]);
  });
});
