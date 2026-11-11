import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cpu } from "lucide-react";
import { pluginIcon, PLUGIN_ICONS } from "./plugin-icons";
import { RECIPE_ICONS } from "./recipe-icons";

// #1187 — every official plugin, integration or recipe, keeps its own icon on
// the Plugins and Integrations pages now that the lookup is a closed set.

const registry = JSON.parse(
  readFileSync(new URL("../../../plugins/registry.json", import.meta.url), "utf8"),
) as { icon?: string; id: string }[];

const registryIcons = registry
  .filter((p) => typeof p.icon === "string")
  .map((p) => [p.id, p.icon as string] as const);

describe("pluginIcon", () => {
  it("reads the whole registry", () => {
    expect(registryIcons.length).toBe(registry.length);
  });

  it.each(registryIcons)("resolves the registry icon of %s (%s)", (_id, icon) => {
    expect(PLUGIN_ICONS[icon]).toBeDefined();
    expect(pluginIcon(icon)).toBe(PLUGIN_ICONS[icon]);
  });

  // Names the backend emits itself, not from a manifest: package-manager.ts
  // (personal source, unreadable manifest) and routes/integrations.ts.
  it.each(["Package", "Puzzle", "Plug"])("resolves the backend-generated icon %s", (icon) => {
    expect(pluginIcon(icon)).toBe(PLUGIN_ICONS[icon]);
    expect(pluginIcon(icon)).not.toBe(Cpu);
  });

  it("resolves every recipe icon the same way as the zone page", () => {
    for (const [name, icon] of Object.entries(RECIPE_ICONS)) expect(pluginIcon(name)).toBe(icon);
  });

  it("falls back to Cpu for an unknown or missing name", () => {
    expect(pluginIcon("NotAnIcon")).toBe(Cpu);
    expect(pluginIcon("toString")).toBe(Cpu);
    expect(pluginIcon(undefined)).toBe(Cpu);
    expect(pluginIcon("")).toBe(Cpu);
  });
});
