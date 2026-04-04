import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import type { Logger } from "../core/logger.js";
import type {
  IntegrationRegistry,
  IntegrationPlugin,
} from "../integrations/integration-registry.js";
import type { PluginManifest, PluginInfo } from "../shared/types.js";
import type { PluginDeps, PluginFactory } from "../shared/plugin-api.js";
import type { PackageManager } from "../packages/package-manager.js";

/**
 * Integration-specific plugin loader.
 * Uses PackageManager for distribution, handles integration lifecycle
 * (import, createPlugin, register with IntegrationRegistry).
 */
export class PluginLoader {
  private packageManager: PackageManager;
  private integrationRegistry: IntegrationRegistry;
  private coreDeps: Omit<PluginDeps, "pluginDir">;
  private logger: Logger;
  private loadedPlugins: Map<string, IntegrationPlugin> = new Map();

  constructor(
    packageManager: PackageManager,
    integrationRegistry: IntegrationRegistry,
    deps: Omit<PluginDeps, "pluginDir">,
    logger: Logger,
  ) {
    this.packageManager = packageManager;
    this.integrationRegistry = integrationRegistry;
    this.coreDeps = deps;
    this.logger = logger.child({ module: "plugin-loader" });
  }

  /**
   * Load all enabled integration packages on startup.
   */
  async loadAll(): Promise<void> {
    this.packageManager.ensureDir();

    const packages = this.packageManager.getInstalledByType("integration");
    let loaded = 0;

    for (const pkg of packages) {
      if (!pkg.enabled) {
        this.logger.debug({ pluginId: pkg.manifest.id }, "Plugin disabled, skipping");
        continue;
      }

      try {
        await this.loadPlugin(pkg.manifest.id);
        loaded++;
      } catch (err) {
        this.logger.error({ err, pluginId: pkg.manifest.id }, "Failed to load plugin");
      }
    }

    this.logger.info({ loaded, total: packages.length }, "Plugins loaded");
  }

  /**
   * Install from GitHub — delegates to PackageManager, then loads the plugin.
   */
  async install(repo: string): Promise<PluginManifest> {
    const manifest = await this.packageManager.installFromGitHub(repo);

    try {
      await this.loadPlugin(manifest.id);
    } catch (err) {
      this.logger.error({ err, pluginId: manifest.id }, "Failed to start plugin after install");
    }

    return manifest;
  }

  /**
   * Update — stop plugin, update files via PackageManager, reload.
   */
  async update(pluginId: string): Promise<PluginManifest> {
    const pkg = this.packageManager.getById(pluginId);
    if (!pkg) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    this.logger.info({ pluginId, from: pkg.manifest.version }, "Updating plugin");

    // Stop plugin
    await this.unloadPlugin(pluginId);

    // Update files + DB
    const newManifest = await this.packageManager.updateFiles(pluginId);

    // Reload if was enabled
    if (pkg.enabled) {
      try {
        await this.loadPlugin(pluginId);
      } catch (err) {
        this.logger.error({ err, pluginId }, "Failed to start plugin after update");
      }
    }

    this.logger.info(
      { pluginId, from: pkg.manifest.version, to: newManifest.version },
      "Plugin updated",
    );
    return newManifest;
  }

  /**
   * Uninstall — stop plugin, remove files via PackageManager.
   */
  async uninstall(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);
    this.packageManager.removeFiles(pluginId);
    this.logger.info({ pluginId }, "Plugin uninstalled");
  }

  /**
   * Enable — set DB flag, load plugin.
   */
  async enable(pluginId: string): Promise<void> {
    this.packageManager.setEnabled(pluginId, true);

    try {
      await this.loadPlugin(pluginId);
    } catch (err) {
      this.logger.error({ err, pluginId }, "Failed to load plugin on enable");
      throw err;
    }

    this.logger.info({ pluginId }, "Plugin enabled");
  }

  /**
   * Disable — set DB flag, stop plugin.
   */
  async disable(pluginId: string): Promise<void> {
    this.packageManager.setEnabled(pluginId, false);
    await this.unloadPlugin(pluginId);
    this.logger.info({ pluginId }, "Plugin disabled");
  }

  /**
   * Get installed plugins enriched with runtime info (status, device counts, latest version).
   */
  getInstalled(): PluginInfo[] {
    const packages = this.packageManager.getInstalledByType("integration");
    const allDevices = this.coreDeps.deviceManager.getAll();
    const latestVersions = this.packageManager.getLatestVersions();

    return packages.map((pkg) => {
      const plugin = this.integrationRegistry.getById(pkg.manifest.id);
      const status = plugin ? plugin.getStatus() : "disconnected";

      const pluginDevices = allDevices.filter((d) => d.integrationId === pkg.manifest.id);
      const offlineDevices = pluginDevices.filter((d) => d.status === "offline");

      const latest = latestVersions.get(pkg.manifest.id);

      return {
        manifest: pkg.manifest,
        enabled: pkg.enabled,
        installedAt: pkg.installedAt,
        status,
        deviceCount: pluginDevices.length,
        offlineDeviceCount: offlineDevices.length,
        ...(latest && latest !== pkg.manifest.version ? { latestVersion: latest } : {}),
      };
    });
  }

  // ============================================================
  // Internal
  // ============================================================

  private async loadPlugin(pluginId: string): Promise<void> {
    const pkgDir = this.packageManager.getPackageDir(pluginId);
    const manifestPath = resolve(pkgDir, "manifest.json");

    if (!existsSync(manifestPath)) {
      throw new Error(`Plugin directory or manifest.json not found for "${pluginId}"`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;

    // Build deps for this plugin
    const deps: PluginDeps = {
      ...this.coreDeps,
      logger: this.coreDeps.logger.child({ module: `plugin:${pluginId}` }),
      pluginDir: pkgDir,
    };

    // Dynamic import of the plugin entry point
    const entryPath = resolve(pkgDir, "dist/index.js");
    if (!existsSync(entryPath)) {
      throw new Error(`Plugin entry point not found: ${entryPath}`);
    }

    // Cache-bust: append timestamp to force fresh import after reinstall
    const mod = (await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)) as {
      createPlugin?: PluginFactory;
      default?: { createPlugin?: PluginFactory };
    };

    const factory = mod.createPlugin ?? mod.default?.createPlugin;
    if (typeof factory !== "function") {
      throw new Error(`Plugin "${pluginId}" does not export a createPlugin function`);
    }

    const plugin = factory(deps);

    // Register with integration registry (start is handled by startAll with staggering)
    this.integrationRegistry.register(plugin);
    this.loadedPlugins.set(pluginId, plugin);

    // Update manifest in DB if it changed on disk
    const pkg = this.packageManager.getById(pluginId);
    if (pkg && pkg.manifest.version !== manifest.version) {
      // Re-read from PackageManager to trigger DB update would need a method,
      // but since we validated manifest already, this is a minor edge case.
      // The version in DB stays correct from install/update flows.
    }
  }

  private async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.loadedPlugins.get(pluginId);
    if (plugin) {
      try {
        const status = plugin.getStatus();
        if (status === "connected" || status === "error") {
          await plugin.stop();
        }
      } catch (err) {
        this.logger.error({ err, pluginId }, "Error stopping plugin");
      }
      this.loadedPlugins.delete(pluginId);
    }

    this.integrationRegistry.unregister(pluginId);
  }
}
