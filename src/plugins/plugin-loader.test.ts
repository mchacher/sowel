import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginLoader } from "./plugin-loader.js";
import { createLogger } from "../core/logger.js";
import type {
  IntegrationPlugin,
  IntegrationRegistry,
} from "../integrations/integration-registry.js";
import type { PackageManager } from "../packages/package-manager.js";
import type { PluginDeps } from "../shared/plugin-api.js";

const logger = createLogger("silent").logger;

/**
 * Minimal stub plugin whose status mimics a slow-starting MQTT plugin —
 * `status` stays "disconnected" until something flips it. The real bug
 * race only became visible when the loader called `unloadPlugin()` on a
 * plugin still inside an in-flight `start()` (so its status was "disconnected"
 * not "connected"), and we want to ensure stop() is called regardless.
 */
function makeStubPlugin(
  opts: {
    id?: string;
    status?: "connected" | "disconnected" | "error" | "not_configured";
  } = {},
): IntegrationPlugin & { stopCalls: number } {
  let stopCalls = 0;
  const plugin = {
    id: opts.id ?? "stub_plugin",
    name: "Stub",
    description: "Stub plugin for unit tests",
    icon: "Zap",
    apiVersion: 2 as const,
    getStatus: () => opts.status ?? "disconnected",
    isConfigured: () => true,
    getSettingsSchema: () => [],
    start: async () => {},
    stop: async () => {
      stopCalls++;
    },
    executeOrder: async () => {},
    get stopCalls() {
      return stopCalls;
    },
  };
  return plugin as unknown as IntegrationPlugin & { stopCalls: number };
}

function makePackageManager(): PackageManager {
  return {
    ensureDir: vi.fn(),
    getInstalledByType: vi.fn(() => []),
    getLatestVersions: vi.fn(() => ({})),
    setEnabled: vi.fn(),
    getById: vi.fn(),
  } as unknown as PackageManager;
}

function makeIntegrationRegistry(): IntegrationRegistry & { unregisterCalls: string[] } {
  const calls: string[] = [];
  const reg = {
    register: vi.fn(),
    unregister: (id: string) => {
      calls.push(id);
    },
    getById: vi.fn(),
    unregisterCalls: calls,
  };
  return reg as unknown as IntegrationRegistry & { unregisterCalls: string[] };
}

function makeCoreDeps(): Omit<PluginDeps, "pluginDir"> {
  return {
    logger,
    eventBus: { on: () => () => {}, emit: () => {} } as unknown as PluginDeps["eventBus"],
    settingsManager: {
      get: () => undefined,
      set: () => {},
    } as unknown as PluginDeps["settingsManager"],
    deviceManager: { getAll: () => [] } as unknown as PluginDeps["deviceManager"],
  };
}

describe("PluginLoader.unloadPlugin", () => {
  let loader: PluginLoader;
  let packageManager: PackageManager;
  let registry: IntegrationRegistry & { unregisterCalls: string[] };

  beforeEach(() => {
    packageManager = makePackageManager();
    registry = makeIntegrationRegistry();
    loader = new PluginLoader(packageManager, registry, makeCoreDeps(), logger);
  });

  /**
   * Drop a fake plugin into the loader's private map so we can exercise
   * unload paths without going through dynamic-import / packageManager.
   */
  function inject(plugin: IntegrationPlugin): void {
    (loader as unknown as { loadedPlugins: Map<string, IntegrationPlugin> }).loadedPlugins.set(
      plugin.id,
      plugin,
    );
  }

  async function unload(pluginId: string): Promise<void> {
    await (loader as unknown as { unloadPlugin: (id: string) => Promise<void> }).unloadPlugin(
      pluginId,
    );
  }

  it("calls stop() on a plugin in 'connected' status", async () => {
    const p = makeStubPlugin({ status: "connected" });
    inject(p);
    await unload(p.id);
    expect(p.stopCalls).toBe(1);
  });

  it("calls stop() on a plugin in 'error' status", async () => {
    const p = makeStubPlugin({ status: "error" });
    inject(p);
    await unload(p.id);
    expect(p.stopCalls).toBe(1);
  });

  it("calls stop() on a plugin in 'disconnected' status (regression for prod race)", async () => {
    // Reproduces the prod race: when the user clicks "Update plugin" while
    // the plugin's start() is still inside `await mqtt.connect()`, status
    // is still "disconnected" — the previous guard skipped stop() here and
    // left the plugin's MQTT subscription / engine running in parallel
    // with the freshly-loaded new plugin instance.
    const p = makeStubPlugin({ status: "disconnected" });
    inject(p);
    await unload(p.id);
    expect(p.stopCalls).toBe(1);
  });

  it("calls stop() on a plugin in 'not_configured' status", async () => {
    const p = makeStubPlugin({ status: "not_configured" });
    inject(p);
    await unload(p.id);
    expect(p.stopCalls).toBe(1);
  });

  it("removes the plugin from the registry even if stop() throws", async () => {
    const p = makeStubPlugin({ status: "connected" });
    p.stop = async () => {
      throw new Error("boom");
    };
    inject(p);

    await unload(p.id); // does not throw

    expect(registry.unregisterCalls).toContain(p.id);
    const loaded = (loader as unknown as { loadedPlugins: Map<string, IntegrationPlugin> })
      .loadedPlugins;
    expect(loaded.has(p.id)).toBe(false);
  });

  it("is a no-op for an unknown pluginId", async () => {
    await unload("does-not-exist"); // does not throw
    expect(registry.unregisterCalls).toContain("does-not-exist");
  });
});
