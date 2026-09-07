import { describe, it, expect } from "vitest";
import { humanizeAlias } from "./humanize-alias";

describe("humanizeAlias", () => {
  it("splits camelCase and snake_case into words, first capitalised", () => {
    expect(humanizeAlias("fanLevel")).toBe("Fan level");
    expect(humanizeAlias("pellet_sensor")).toBe("Pellet sensor");
    expect(humanizeAlias("swing")).toBe("Swing");
  });

  it("keeps an acronym token as it is", () => {
    expect(humanizeAlias("airSwingUD")).toBe("Air swing UD");
  });

  it("survives an empty alias", () => {
    expect(humanizeAlias("")).toBe("");
  });
});
