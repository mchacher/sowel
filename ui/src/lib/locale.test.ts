import { describe, expect, it } from "vitest";
import { dateLocale } from "./locale";

describe("dateLocale", () => {
  it("accepts the regional tag the detector actually stores", () => {
    // The bug this exists for: "fr-FR" is what `navigator.language` reports, and
    // an equality test against "fr" sent a French household to en-US formatting
    // while every label around it stayed in French.
    expect(dateLocale("fr-FR")).toBe("fr-FR");
  });

  it("accepts the bare language too", () => {
    expect(dateLocale("fr")).toBe("fr-FR");
  });

  it("accepts the other French regions", () => {
    expect(dateLocale("fr-CH")).toBe("fr-FR");
    expect(dateLocale("fr-BE")).toBe("fr-FR");
    expect(dateLocale("fr-CA")).toBe("fr-FR");
  });

  it("is not confused by case", () => {
    expect(dateLocale("FR-fr")).toBe("fr-FR");
  });

  it("falls back to en-US for anything else", () => {
    expect(dateLocale("en")).toBe("en-US");
    expect(dateLocale("en-GB")).toBe("en-US");
    expect(dateLocale("de-DE")).toBe("en-US");
  });

  it("survives an undefined or empty language", () => {
    expect(dateLocale(undefined)).toBe("en-US");
    expect(dateLocale("")).toBe("en-US");
  });

  it("matches on the prefix, not on a substring anywhere", () => {
    // A `includes("fr")` fix would be the obvious wrong one.
    expect(dateLocale("af-ZA")).toBe("en-US");
  });
});
