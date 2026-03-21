import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type {
  IntegrationRegistry,
  IntegrationPlugin,
} from "../integrations/integration-registry.js";
import type { PluginManifest, PluginInfo } from "../shared/types.js";
import type { PluginDeps, PluginFactory } from "../shared/plugin-api.js";

const execFile = promisify(execFileCb);

interface PluginRow {
  id: string;
  version: string;
  enabled: number;
  installed_at: string;
  manifest: string;
}

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  author: string;
  repo: string;
  tags: string[];
}

export class PluginManager {
  private db: Database.Database;
  private integrationRegistry: IntegrationRegistry;
  private coreDeps: Omit<PluginDeps, "pluginDir">;
  private logger: Logger;
  private pluginsDir: string;
  private loadedPlugins: Map<string, IntegrationPlugin> = new Map();

  // Prepared statements
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(
    db: Database.Database,
    integrationRegistry: IntegrationRegistry,
    deps: Omit<PluginDeps, "pluginDir">,
    logger: Logger,
  ) {
    this.db = db;
    this.integrationRegistry = integrationRegistry;
    this.coreDeps = deps;
    this.logger = logger.child({ module: "plugin-manager" });
    this.pluginsDir = resolve(process.cwd(), "plugins");
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      getAll: this.db.prepare("SELECT * FROM plugins"),
      getById: this.db.prepare<[string]>("SELECT * FROM plugins WHERE id = ?"),
      insert: this.db.prepare(
        `INSERT INTO plugins (id, version, enabled, installed_at, manifest)
         VALUES (@id, @version, @enabled, @installedAt, @manifest)`,
      ),
      updateEnabled: this.db.prepare("UPDATE plugins SET enabled = ? WHERE id = ?"),
      updateManifest: this.db.prepare("UPDATE plugins SET version = ?, manifest = ? WHERE id = ?"),
      remove: this.db.prepare<[string]>("DELETE FROM plugins WHERE id = ?"),
    };
  }

  /**
   * Called on startup — scan plugins/ directory, load enabled ones.
   */
  async loadAll(): Promise<void> {
    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true });
    }

    const rows = this.stmts.getAll.all() as PluginRow[];
    let loaded = 0;

    for (const row of rows) {
      if (!row.enabled) {
        this.logger.debug({ pluginId: row.id }, "Plugin disabled, skipping");
        continue;
      }

      try {
        await this.loadPlugin(row.id);
        loaded++;
      } catch (err) {
        this.logger.error({ err, pluginId: row.id }, "Failed to load plugin");
      }
    }

    this.logger.info({ loaded, total: rows.length }, "Plugins loaded");
  }

  /**
   * Install from GitHub — download tarball, extract, npm install, register in DB.
   */
  async installFromGitHub(repo: string): Promise<PluginManifest> {
    this.logger.info({ repo }, "Installing plugin from GitHub");

    // 1. Fetch latest release from GitHub API
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const releaseRes = await fetch(apiUrl, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!releaseRes.ok) {
      throw new Error(`GitHub API error: ${releaseRes.status} ${releaseRes.statusText}`);
    }

    const release = (await releaseRes.json()) as {
      tarball_url: string;
      assets?: { name: string; browser_download_url: string }[];
    };
    // Prefer uploaded asset (includes dist/), fallback to source tarball
    const asset = release.assets?.find((a) => a.name.endsWith(".tar.gz"));
    const tarballUrl = asset?.browser_download_url ?? release.tarball_url;

    // 2. Download the tarball
    const tarballRes = await fetch(tarballUrl);
    if (!tarballRes.ok || !tarballRes.body) {
      throw new Error(`Failed to download tarball: ${tarballRes.status}`);
    }

    // Write to a temporary file
    const tmpDir = resolve(this.pluginsDir, ".tmp");
    mkdirSync(tmpDir, { recursive: true });
    const tarballPath = resolve(tmpDir, "plugin.tar.gz");

    const fileStream = createWriteStream(tarballPath);
    // Node 20+ fetch body is a ReadableStream; convert to Node stream
    await pipeline(tarballRes.body as unknown as NodeJS.ReadableStream, fileStream);

    // 3. Extract to a temp directory, then move to final location
    const extractDir = resolve(tmpDir, "extract");
    mkdirSync(extractDir, { recursive: true });

    try {
      await execFile("tar", ["-xzf", tarballPath, "-C", extractDir, "--strip-components=1"]);
    } catch (err) {
      throw new Error(
        `Failed to extract tarball: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // 4. Read and validate manifest
    const manifestPath = resolve(extractDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error("Plugin archive does not contain manifest.json");
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
    this.validateManifest(manifest);

    // Check if already installed
    const existing = this.stmts.getById.get(manifest.id) as PluginRow | undefined;
    if (existing) {
      throw new Error(`Plugin "${manifest.id}" is already installed`);
    }

    // 5. Move to final plugin directory
    const pluginDir = resolve(this.pluginsDir, manifest.id);
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true });
    }
    // Use rename via moving files
    const { rename } = await import("node:fs/promises");
    await rename(extractDir, pluginDir);

    // 6. If package.json exists, run npm install --production
    const packageJsonPath = resolve(pluginDir, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        await execFile("npm", ["install", "--production", "--no-audit", "--no-fund"], {
          cwd: pluginDir,
          timeout: 120_000,
        });
        this.logger.debug({ pluginId: manifest.id }, "npm install completed");
      } catch (err) {
        this.logger.warn(
          { err, pluginId: manifest.id },
          "npm install failed — plugin may still work if no dependencies needed",
        );
      }
    }

    // 6b. If dist/ does not exist but tsconfig.json does, try to build
    const distDir = resolve(pluginDir, "dist");
    const tsconfigPath = resolve(pluginDir, "tsconfig.json");
    if (!existsSync(distDir) && existsSync(tsconfigPath)) {
      try {
        await execFile("npx", ["tsc"], { cwd: pluginDir, timeout: 60_000 });
        this.logger.debug({ pluginId: manifest.id }, "Plugin built from source");
      } catch (err) {
        this.logger.warn({ err, pluginId: manifest.id }, "Plugin build failed");
      }
    }

    // 7. Insert into plugins DB table
    this.stmts.insert.run({
      id: manifest.id,
      version: manifest.version,
      enabled: 1,
      installedAt: new Date().toISOString(),
      manifest: JSON.stringify(manifest),
    });

    // 8. Load and start the plugin
    try {
      await this.loadPlugin(manifest.id);
    } catch (err) {
      this.logger.error({ err, pluginId: manifest.id }, "Failed to start plugin after install");
    }

    // Cleanup tmp
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }

    this.logger.info({ pluginId: manifest.id, version: manifest.version }, "Plugin installed");
    return manifest;
  }

  /**
   * Uninstall — stop plugin, remove from registry, delete files, remove from DB.
   */
  async uninstall(pluginId: string): Promise<void> {
    const row = this.stmts.getById.get(pluginId) as PluginRow | undefined;
    if (!row) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    // Stop and unregister
    await this.unloadPlugin(pluginId);

    // Delete plugin files
    const pluginDir = resolve(this.pluginsDir, pluginId);
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true });
    }

    // Remove from DB
    this.stmts.remove.run(pluginId);

    this.logger.info({ pluginId }, "Plugin uninstalled");
  }

  /**
   * Enable — load and start the plugin.
   */
  async enable(pluginId: string): Promise<void> {
    const row = this.stmts.getById.get(pluginId) as PluginRow | undefined;
    if (!row) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    this.stmts.updateEnabled.run(1, pluginId);

    try {
      await this.loadPlugin(pluginId);
    } catch (err) {
      this.logger.error({ err, pluginId }, "Failed to load plugin on enable");
      throw err;
    }

    this.logger.info({ pluginId }, "Plugin enabled");
  }

  /**
   * Disable — stop the plugin.
   */
  async disable(pluginId: string): Promise<void> {
    const row = this.stmts.getById.get(pluginId) as PluginRow | undefined;
    if (!row) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    this.stmts.updateEnabled.run(0, pluginId);
    await this.unloadPlugin(pluginId);

    this.logger.info({ pluginId }, "Plugin disabled");
  }

  /**
   * Get all installed plugins with status.
   */
  getInstalled(): PluginInfo[] {
    const rows = this.stmts.getAll.all() as PluginRow[];
    const allDevices = this.coreDeps.deviceManager.getAll();

    return rows.map((row) => {
      let manifest: PluginManifest;
      try {
        manifest = JSON.parse(row.manifest) as PluginManifest;
      } catch {
        manifest = {
          id: row.id,
          name: row.id,
          version: row.version,
          description: "",
          icon: "Puzzle",
        };
      }

      const plugin = this.integrationRegistry.getById(row.id);
      const status = plugin ? plugin.getStatus() : "disconnected";

      const pluginDevices = allDevices.filter((d) => d.integrationId === row.id);
      const offlineDevices = pluginDevices.filter((d) => d.status === "offline");

      return {
        manifest,
        enabled: row.enabled === 1,
        installedAt: row.installed_at,
        status,
        deviceCount: pluginDevices.length,
        offlineDeviceCount: offlineDevices.length,
      };
    });
  }

  /**
   * Get available plugins from registry.
   */
  getStore(): PluginManifest[] {
    const registryPath = resolve(this.pluginsDir, "registry.json");
    if (!existsSync(registryPath)) {
      return [];
    }

    try {
      const entries = JSON.parse(readFileSync(registryPath, "utf-8")) as RegistryEntry[];
      const installedIds = new Set((this.stmts.getAll.all() as PluginRow[]).map((r) => r.id));

      return entries
        .filter((e) => !installedIds.has(e.id))
        .map(
          (e): PluginManifest => ({
            id: e.id,
            name: e.name,
            version: "", // version unknown until installed
            description: e.description,
            icon: e.icon,
            author: e.author,
            repo: e.repo,
          }),
        );
    } catch (err) {
      this.logger.error({ err }, "Failed to read plugin registry");
      return [];
    }
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  private async loadPlugin(pluginId: string): Promise<void> {
    const pluginDir = resolve(this.pluginsDir, pluginId);
    const manifestPath = resolve(pluginDir, "manifest.json");

    if (!existsSync(manifestPath)) {
      throw new Error(`Plugin directory or manifest.json not found for "${pluginId}"`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;

    // Build deps for this plugin
    const deps: PluginDeps = {
      ...this.coreDeps,
      logger: this.coreDeps.logger.child({ module: `plugin:${pluginId}` }),
      pluginDir,
    };

    // Dynamic import of the plugin entry point
    const entryPath = resolve(pluginDir, "dist/index.js");
    if (!existsSync(entryPath)) {
      throw new Error(`Plugin entry point not found: ${entryPath}`);
    }

    const mod = (await import(pathToFileURL(entryPath).href)) as {
      createPlugin?: PluginFactory;
      default?: { createPlugin?: PluginFactory };
    };

    const factory = mod.createPlugin ?? mod.default?.createPlugin;
    if (typeof factory !== "function") {
      throw new Error(`Plugin "${pluginId}" does not export a createPlugin function`);
    }

    const plugin = factory(deps);

    // Register with integration registry
    this.integrationRegistry.register(plugin);
    this.loadedPlugins.set(pluginId, plugin);

    // Start the plugin if it is configured
    if (plugin.isConfigured()) {
      try {
        await plugin.start();
        this.logger.info({ pluginId }, "Plugin started");
      } catch (err) {
        this.logger.error({ err, pluginId }, "Plugin start failed");
      }
    } else {
      this.logger.info({ pluginId }, "Plugin loaded but not configured — skipping start");
    }

    // Update manifest in DB if it changed
    const row = this.stmts.getById.get(pluginId) as PluginRow | undefined;
    if (row && row.version !== manifest.version) {
      this.stmts.updateManifest.run(manifest.version, JSON.stringify(manifest), pluginId);
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

  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.id || typeof manifest.id !== "string") {
      throw new Error("Plugin manifest missing 'id'");
    }
    if (!manifest.name || typeof manifest.name !== "string") {
      throw new Error("Plugin manifest missing 'name'");
    }
    if (!manifest.version || typeof manifest.version !== "string") {
      throw new Error("Plugin manifest missing 'version'");
    }
    if (!manifest.description || typeof manifest.description !== "string") {
      throw new Error("Plugin manifest missing 'description'");
    }
    if (!manifest.icon || typeof manifest.icon !== "string") {
      throw new Error("Plugin manifest missing 'icon'");
    }
  }
}
