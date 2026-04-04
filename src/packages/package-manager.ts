import { resolve } from "node:path";
import { existsSync, readFileSync, mkdirSync, rmSync, createWriteStream } from "node:fs";
import { rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { PluginManifest, InstalledPackage, PackageType } from "../shared/types.js";

const execFile = promisify(execFileCb);

interface PackageRow {
  id: string;
  version: string;
  enabled: number;
  installed_at: string;
  manifest: string;
  type: string;
}

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  author: string;
  repo: string;
  version?: string;
  type?: string;
  tags: string[];
}

/**
 * Generic package distribution manager.
 * Handles download, install, update, uninstall, registry, and DB persistence.
 * No domain-specific logic (no createPlugin, no integrationRegistry).
 */
export class PackageManager {
  private db: Database.Database;
  private logger: Logger;
  private pluginsDir: string;
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(db: Database.Database, logger: Logger) {
    this.db = db;
    this.logger = logger.child({ module: "package-manager" });
    this.pluginsDir = resolve(process.cwd(), "plugins");
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      getAll: this.db.prepare("SELECT * FROM plugins"),
      getAllByType: this.db.prepare<[string]>("SELECT * FROM plugins WHERE type = ?"),
      getById: this.db.prepare<[string]>("SELECT * FROM plugins WHERE id = ?"),
      insert: this.db.prepare(
        `INSERT INTO plugins (id, version, enabled, installed_at, manifest, type)
         VALUES (@id, @version, @enabled, @installedAt, @manifest, @type)`,
      ),
      updateEnabled: this.db.prepare("UPDATE plugins SET enabled = ? WHERE id = ?"),
      updateManifest: this.db.prepare("UPDATE plugins SET version = ?, manifest = ? WHERE id = ?"),
      remove: this.db.prepare<[string]>("DELETE FROM plugins WHERE id = ?"),
    };
  }

  /** Ensure plugins directory exists */
  ensureDir(): void {
    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true });
    }
  }

  /** Resolve absolute path to a package directory */
  getPackageDir(packageId: string): string {
    return resolve(this.pluginsDir, packageId);
  }

  /** Get all installed packages (raw DB data, no runtime enrichment) */
  getInstalled(): InstalledPackage[] {
    const rows = this.stmts.getAll.all() as PackageRow[];
    return rows.map((row) => this.rowToPackage(row));
  }

  /** Get installed packages filtered by type */
  getInstalledByType(type: PackageType): InstalledPackage[] {
    const rows = this.stmts.getAllByType.all(type) as PackageRow[];
    return rows.map((row) => this.rowToPackage(row));
  }

  /** Check if a package is installed */
  isInstalled(packageId: string): boolean {
    return !!this.stmts.getById.get(packageId);
  }

  /** Get a single installed package by ID */
  getById(packageId: string): InstalledPackage | undefined {
    const row = this.stmts.getById.get(packageId) as PackageRow | undefined;
    return row ? this.rowToPackage(row) : undefined;
  }

  /**
   * Get available packages from registry (not yet installed).
   */
  getStore(): PluginManifest[] {
    const registryPath = resolve(this.pluginsDir, "registry.json");
    if (!existsSync(registryPath)) return [];

    try {
      const entries = JSON.parse(readFileSync(registryPath, "utf-8")) as RegistryEntry[];
      const installedIds = new Set((this.stmts.getAll.all() as PackageRow[]).map((r) => r.id));

      return entries
        .filter((e) => !installedIds.has(e.id))
        .map(
          (e): PluginManifest => ({
            id: e.id,
            name: e.name,
            version: e.version ?? "",
            description: e.description,
            icon: e.icon,
            author: e.author,
            repo: e.repo,
            type: (e.type as PackageType) ?? "integration",
          }),
        );
    } catch (err) {
      this.logger.error({ err }, "Failed to read plugin registry");
      return [];
    }
  }

  /** Get available packages from registry filtered by type */
  getStoreByType(type: PackageType): PluginManifest[] {
    return this.getStore().filter((m) => (m.type ?? "integration") === type);
  }

  /**
   * Install from GitHub — download pre-built tarball, extract, register in DB.
   * Returns the manifest. Does NOT load the package (caller handles that).
   */
  async installFromGitHub(repo: string): Promise<PluginManifest> {
    this.logger.info({ repo }, "Installing package from GitHub");

    const tmpDir = resolve(this.pluginsDir, ".tmp");
    try {
      const extractDir = await this.downloadPrebuiltAsset(repo, tmpDir);

      // Read and validate manifest
      const manifestPath = resolve(extractDir, "manifest.json");
      if (!existsSync(manifestPath)) {
        throw new Error("Package archive does not contain manifest.json");
      }

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
      this.validateManifest(manifest);

      // Check if already installed
      const existing = this.stmts.getById.get(manifest.id) as PackageRow | undefined;
      if (existing) {
        throw new Error(`Package "${manifest.id}" is already installed`);
      }

      // Move to final directory
      const pkgDir = resolve(this.pluginsDir, manifest.id);
      if (existsSync(pkgDir)) {
        rmSync(pkgDir, { recursive: true });
      }
      await rename(extractDir, pkgDir);

      // Insert into DB
      const type = manifest.type ?? "integration";
      this.stmts.insert.run({
        id: manifest.id,
        version: manifest.version,
        enabled: 1,
        installedAt: new Date().toISOString(),
        manifest: JSON.stringify(manifest),
        type,
      });

      this.logger.info(
        { packageId: manifest.id, version: manifest.version, type },
        "Package installed",
      );
      return manifest;
    } finally {
      try {
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Update — download new version, replace files, update DB.
   * Caller must stop/unload before calling and reload after.
   */
  async updateFiles(packageId: string): Promise<PluginManifest> {
    const row = this.stmts.getById.get(packageId) as PackageRow | undefined;
    if (!row) {
      throw new Error(`Package "${packageId}" is not installed`);
    }

    const currentManifest = JSON.parse(row.manifest) as PluginManifest;
    const repo = currentManifest.repo ?? this.getRepoFromRegistry(packageId);
    if (!repo) {
      throw new Error(`Package "${packageId}" has no repo in manifest or registry — cannot update`);
    }

    this.logger.info({ packageId, from: row.version, repo }, "Updating package");

    const tmpDir = resolve(this.pluginsDir, ".tmp");
    try {
      const extractDir = await this.downloadPrebuiltAsset(repo, tmpDir);

      const manifestPath = resolve(extractDir, "manifest.json");
      if (!existsSync(manifestPath)) {
        throw new Error("New package version does not contain manifest.json");
      }
      const newManifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
      this.validateManifest(newManifest);

      // Replace files
      const pkgDir = resolve(this.pluginsDir, packageId);
      if (existsSync(pkgDir)) {
        rmSync(pkgDir, { recursive: true });
      }
      await rename(extractDir, pkgDir);

      // Update DB
      this.stmts.updateManifest.run(newManifest.version, JSON.stringify(newManifest), packageId);

      this.logger.info(
        { packageId, from: row.version, to: newManifest.version },
        "Package updated",
      );
      return newManifest;
    } finally {
      try {
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /** Remove package files and DB record. Caller must stop/unload first. */
  removeFiles(packageId: string): void {
    const row = this.stmts.getById.get(packageId) as PackageRow | undefined;
    if (!row) {
      throw new Error(`Package "${packageId}" is not installed`);
    }

    const pkgDir = resolve(this.pluginsDir, packageId);
    if (existsSync(pkgDir)) {
      rmSync(pkgDir, { recursive: true });
    }

    this.stmts.remove.run(packageId);
    this.logger.info({ packageId }, "Package removed");
  }

  /** Set enabled flag in DB */
  setEnabled(packageId: string, enabled: boolean): void {
    const row = this.stmts.getById.get(packageId) as PackageRow | undefined;
    if (!row) {
      throw new Error(`Package "${packageId}" is not installed`);
    }
    this.stmts.updateEnabled.run(enabled ? 1 : 0, packageId);
  }

  /** Read registry.json and return a map of packageId → latest version */
  getLatestVersions(): Map<string, string> {
    const versions = new Map<string, string>();
    const registryPath = resolve(this.pluginsDir, "registry.json");
    if (!existsSync(registryPath)) return versions;

    try {
      const entries = JSON.parse(readFileSync(registryPath, "utf-8")) as RegistryEntry[];
      for (const e of entries) {
        if (e.version) versions.set(e.id, e.version);
      }
    } catch {
      // Ignore registry read errors
    }
    return versions;
  }

  /** Lookup repo URL from registry */
  getRepoFromRegistry(packageId: string): string | undefined {
    const registryPath = resolve(this.pluginsDir, "registry.json");
    if (!existsSync(registryPath)) return undefined;
    try {
      const entries = JSON.parse(readFileSync(registryPath, "utf-8")) as RegistryEntry[];
      return entries.find((e) => e.id === packageId)?.repo;
    } catch {
      return undefined;
    }
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  private async downloadPrebuiltAsset(repo: string, tmpDir: string): Promise<string> {
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const releaseRes = await fetch(apiUrl, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!releaseRes.ok) {
      throw new Error(`GitHub API error: ${releaseRes.status} ${releaseRes.statusText}`);
    }

    const release = (await releaseRes.json()) as {
      tag_name: string;
      assets?: { name: string; browser_download_url: string }[];
    };

    const asset = release.assets?.find(
      (a) => a.name.startsWith("sowel-") && a.name.endsWith(".tar.gz"),
    );
    if (!asset) {
      throw new Error(
        `Release ${release.tag_name} for ${repo} has no pre-built tarball asset (sowel-*.tar.gz)`,
      );
    }

    this.logger.debug(
      { repo, asset: asset.name, tag: release.tag_name },
      "Downloading pre-built package asset",
    );

    const tarballRes = await fetch(asset.browser_download_url);
    if (!tarballRes.ok || !tarballRes.body) {
      throw new Error(`Failed to download asset: ${tarballRes.status}`);
    }

    mkdirSync(tmpDir, { recursive: true });
    const tarballPath = resolve(tmpDir, "package.tar.gz");

    const fileStream = createWriteStream(tarballPath);
    await pipeline(tarballRes.body as unknown as NodeJS.ReadableStream, fileStream);

    const extractDir = resolve(tmpDir, "extract");
    mkdirSync(extractDir, { recursive: true });

    try {
      await execFile("tar", ["-xzf", tarballPath, "-C", extractDir]);
    } catch (err) {
      throw new Error(
        `Failed to extract tarball: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    return extractDir;
  }

  private rowToPackage(row: PackageRow): InstalledPackage {
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
        repo: this.getRepoFromRegistry(row.id) ?? "",
      };
    }
    return {
      manifest,
      enabled: row.enabled === 1,
      installedAt: row.installed_at,
      type: (row.type as PackageType) ?? "integration",
    };
  }

  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.id || typeof manifest.id !== "string") {
      throw new Error("Package manifest missing 'id'");
    }
    if (!manifest.name || typeof manifest.name !== "string") {
      throw new Error("Package manifest missing 'name'");
    }
    if (!manifest.version || typeof manifest.version !== "string") {
      throw new Error("Package manifest missing 'version'");
    }
    if (!manifest.description || typeof manifest.description !== "string") {
      throw new Error("Package manifest missing 'description'");
    }
    if (!manifest.icon || typeof manifest.icon !== "string") {
      throw new Error("Package manifest missing 'icon'");
    }
    if (!manifest.repo || typeof manifest.repo !== "string") {
      throw new Error("Package manifest missing 'repo' (GitHub owner/repo)");
    }
  }
}
