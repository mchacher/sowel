/**
 * Spec 180 — which plugins offer a page, read from their manifests.
 *
 * The list drives a sidebar entry, so what matters is that it never promises
 * a page that is not there and never hides one that is: a plugin whose
 * integration failed to start still has its page.
 */

import { describe, it, expect, vi } from "vitest";
import { PluginLoader } from "./plugin-loader.js";
import { createLogger } from "../core/logger.js";
import type { IntegrationRegistry } from "../integrations/integration-registry.js";
import type { PackageManager } from "../packages/package-manager.js";
import type { PluginDeps } from "../shared/plugin-api.js";
import type { PluginManifest } from "../shared/types.js";

const logger = createLogger("silent").logger;

function makeLoader(
  packages: Array<{ manifest: Partial<PluginManifest>; enabled: boolean }>,
): PluginLoader {
  const packageManager = {
    ensureDir: vi.fn(),
    getInstalledByType: vi.fn(() => packages),
    getById: vi.fn(),
  } as unknown as PackageManager;
  const registry = { register: vi.fn(), unregister: vi.fn(), getById: vi.fn() };
  const coreDeps = {
    logger,
    eventBus: { on: () => () => {}, emit: () => {} },
    settingsManager: { get: () => undefined, set: () => {} },
    deviceManager: { getAll: () => [] },
  } as unknown as Omit<PluginDeps, "pluginDir" | "dataDir">;
  return new PluginLoader(
    packageManager,
    registry as unknown as IntegrationRegistry,
    coreDeps,
    logger,
  );
}

const base = { id: "guest-access", name: "Guest Access", icon: "Cpu", version: "1.0.0" };

describe("PluginLoader.getPages", () => {
  it("names the page from the manifest, and its URL from the entry", () => {
    const loader = makeLoader([
      {
        manifest: {
          ...base,
          ui: { entry: "ui/panel.js", label: "Accès invités", icon: "DoorOpen" },
        },
        enabled: true,
      },
    ]);
    expect(loader.getPages()).toEqual([
      {
        pluginId: "guest-access",
        label: "Accès invités",
        icon: "DoorOpen",
        placement: "admin",
        entryUrl: "/plugin-ui/guest-access/panel.js?v=1.0.0",
      },
    ]);
  });

  it("lists a page in the main navigation only when the manifest asks for it (R1.6.bis)", () => {
    const loader = makeLoader([
      {
        manifest: { ...base, ui: { entry: "ui/panel.js", label: "X", placement: "main" } },
        enabled: true,
      },
      {
        manifest: {
          ...base,
          id: "odd",
          // Anything unexpected is where every page used to be.
          ui: { entry: "ui/panel.js", label: "Y", placement: "sidebar" as unknown as "main" },
        },
        enabled: true,
      },
    ]);
    expect(loader.getPages().map((p) => p.placement)).toEqual(["main", "admin"]);
  });

  it("falls back to the plugin's own name and icon", () => {
    const loader = makeLoader([
      { manifest: { ...base, ui: { entry: "ui/panel.js", label: "" } }, enabled: true },
    ]);
    expect(loader.getPages()[0]).toMatchObject({ label: "Guest Access", icon: "Cpu" });
  });

  it("ignores a plugin that declares no page", () => {
    const loader = makeLoader([{ manifest: base, enabled: true }]);
    expect(loader.getPages()).toEqual([]);
  });

  it("ignores a disabled plugin — the page would 404 on its own assets", () => {
    const loader = makeLoader([
      { manifest: { ...base, ui: { entry: "ui/panel.js", label: "X" } }, enabled: false },
    ]);
    expect(loader.getPages()).toEqual([]);
  });

  it("ignores a manifest whose entry is empty or not a string", () => {
    const loader = makeLoader([
      { manifest: { ...base, ui: { entry: "", label: "X" } }, enabled: true },
      {
        manifest: { ...base, id: "other", ui: { entry: 42 as unknown as string, label: "X" } },
        enabled: true,
      },
    ]);
    expect(loader.getPages()).toEqual([]);
  });

  it("normalises a leading slash rather than building a double one", () => {
    const loader = makeLoader([
      { manifest: { ...base, ui: { entry: "/ui/panel.js", label: "X" } }, enabled: true },
    ]);
    // The entry is `ui/panel.js` in the manifest, and the asset tree serves
    // that directory AS `/plugin-ui/<id>/` — so the announced URL carries the
    // file name, not the path inside the package.
    expect(loader.getPages()[0].entryUrl).toBe("/plugin-ui/guest-access/panel.js?v=1.0.0");
  });

  it("carries the installed version, so an update is not served from the ESM cache", () => {
    const loader = makeLoader([
      {
        manifest: { ...base, version: "1.1.0", ui: { entry: "ui/panel.js", label: "X" } },
        enabled: true,
      },
    ]);
    expect(loader.getPages()[0].entryUrl).toContain("?v=1.1.0");
  });
});
