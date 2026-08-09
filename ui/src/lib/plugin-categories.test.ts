import { describe, it, expect } from "vitest";
import {
  categoryOf,
  groupByCategory,
  matchesQuery,
  normalizeForSearch,
} from "./plugin-categories";
import type { PluginManifest } from "../types";

function manifest(overrides: Partial<PluginManifest>): PluginManifest {
  return {
    id: "motion-light",
    name: "Motion Light",
    version: "1.0.0",
    description: "Turn a light on when motion is detected",
    icon: "Lightbulb",
    type: "recipe",
    ...overrides,
  };
}

describe("categoryOf", () => {
  it("returns a known category as-is", () => {
    expect(categoryOf(manifest({ category: "lighting" }))).toBe("lighting");
  });

  it("buckets a missing category into other", () => {
    expect(categoryOf(manifest({}))).toBe("other");
  });

  it("buckets an unknown category value into other", () => {
    expect(categoryOf(manifest({ category: "disco" }))).toBe("other");
  });
});

describe("normalizeForSearch", () => {
  it("lowercases and strips diacritics", () => {
    expect(normalizeForSearch("Éclairage Extérieur")).toBe("eclairage exterieur");
  });
});

describe("matchesQuery", () => {
  it("matches everything on a blank or whitespace query", () => {
    expect(matchesQuery(manifest({}), "en", "")).toBe(true);
    expect(matchesQuery(manifest({}), "en", "   ")).toBe(true);
  });

  it("matches the name case-insensitively", () => {
    expect(matchesQuery(manifest({}), "en", "MOTION")).toBe(true);
  });

  it("matches the description", () => {
    expect(matchesQuery(manifest({}), "en", "detected")).toBe(true);
  });

  it("matches tags", () => {
    expect(matchesQuery(manifest({ tags: ["zigbee", "mqtt"] }), "en", "zigbee")).toBe(true);
  });

  it("matches the localized name for the active language, diacritics-insensitive", () => {
    const m = manifest({
      i18n: { fr: { name: "Lumière mouvement", description: "Allume la lumière" } },
    });
    expect(matchesQuery(m, "fr", "lumiere")).toBe(true);
    // The EN strings are not searched when FR is active and translated.
    expect(matchesQuery(m, "fr", "motion light")).toBe(false);
  });

  it("returns false when nothing matches", () => {
    expect(matchesQuery(manifest({}), "en", "heater")).toBe(false);
  });
});

describe("groupByCategory", () => {
  const items = [
    manifest({ id: "b-light", name: "B Light", category: "lighting" }),
    manifest({ id: "a-light", name: "A Light", category: "lighting" }),
    manifest({ id: "heater", name: "Heater", category: "climate" }),
    manifest({ id: "mystery", name: "Mystery" }),
  ];

  it("orders buckets by the fixed taxonomy order and drops empty ones", () => {
    const groups = groupByCategory(items, (m) => m, "en");
    expect(groups.map((g) => g.category)).toEqual(["lighting", "climate", "other"]);
  });

  it("sorts items alphabetically by localized name within a bucket", () => {
    const groups = groupByCategory(items, (m) => m, "en");
    expect(groups[0].items.map((m) => m.id)).toEqual(["a-light", "b-light"]);
  });

  it("returns an empty array for no items", () => {
    expect(groupByCategory([], (m: PluginManifest) => m, "en")).toEqual([]);
  });
});
