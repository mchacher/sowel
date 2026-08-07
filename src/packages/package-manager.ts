import { resolve, relative, sep } from "node:path";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  createWriteStream,
  lstatSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { PluginManifest, InstalledPackage, PackageType } from "../shared/types.js";
import {
  type RegistryEntry,
  ChecksumMismatchError,
  CommunityPluginConfirmationRequiredError,
  RegistryEntryInvalidError,
  SymlinkInTarballError,
  isOfficial,
} from "./registry-types.js";

const execFile = promisify(execFileCb);

const REGISTRY_URL = "https://raw.githubusercontent.com/mchacher/sowel/main/plugins/registry.json";
// GitHub Contents API — reflects `main` immediately, with none of the ~5 min
// Fastly CDN that raw.githubusercontent.com serves (and that a `?t=` query
// string does NOT bypass). Used only by the manual "Refresh" button so a
// registry merge is visible within seconds; the passive/background path stays
// on raw to avoid the API's 60/h unauthenticated rate limit (issue #353).
const REGISTRY_API_URL =
  "https://api.github.com/repos/mchacher/sowel/contents/plugins/registry.json";
const REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SHA256_HEX = /^[a-f0-9]{64}$/i;

interface PackageRow {
  id: string;
  version: string;
  enabled: number;
  installed_at: string;
  manifest: string;
  type: string;
}

/** Options passed to install() and installFromGitHub(). */
export interface InstallOptions {
  /** Explicit confirmation that a community plugin can be installed (spec 089 C1). */
  confirmed?: boolean;
}

/** Simple semver ">=" check: returns true if current >= required. */
function semverSatisfiesGte(current: string, required: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^[>=<^~\s]+/, "")
      .split(".")
      .map(Number);
  const c = parse(current);
  const r = parse(required);
  for (let i = 0; i < 3; i++) {
    if ((c[i] ?? 0) > (r[i] ?? 0)) return true;
    if ((c[i] ?? 0) < (r[i] ?? 0)) return false;
  }
  return true; // equal
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
  private registryCache: RegistryEntry[] | null = null;
  private registryCacheTime = 0;
  private sowelVersionCache: string | null = null;

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

  /** Get the current Sowel version from package.json (cached). */
  getCurrentVersion(): string {
    if (this.sowelVersionCache) return this.sowelVersionCache;
    try {
      const pkgPath = resolve(process.cwd(), "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
      this.sowelVersionCache = pkg.version;
      return pkg.version;
    } catch {
      return "0.0.0";
    }
  }

  /** Check if a sowelVersion constraint is compatible with the current version. */
  isCompatible(sowelVersion?: string): boolean {
    if (!sowelVersion) return true; // No constraint = compatible
    return semverSatisfiesGte(this.getCurrentVersion(), sowelVersion);
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
   * Each entry is enriched with `compatible` + `isOfficial` (spec 089 C1)
   * so the UI can render a community badge.
   */
  getStore(): (PluginManifest & {
    compatible: boolean;
    compatReason?: string;
    isOfficial: boolean;
  })[] {
    const entries = this.getRegistryEntries();
    const installedIds = new Set((this.stmts.getAll.all() as PackageRow[]).map((r) => r.id));

    return entries
      .filter((e) => !installedIds.has(e.id))
      .map((e) => {
        const compatible = this.isCompatible(e.sowelVersion);
        return {
          id: e.id,
          name: e.name,
          version: e.version ?? "",
          description: e.description,
          icon: e.icon,
          author: e.author,
          repo: e.repo,
          type: (e.type as PackageType) ?? "integration",
          sowelVersion: e.sowelVersion,
          compatible,
          isOfficial: isOfficial(e),
          ...(!compatible ? { compatReason: `Requires Sowel >= ${e.sowelVersion}` } : {}),
        };
      });
  }

  /** Get available packages from registry filtered by type */
  getStoreByType(type: PackageType): PluginManifest[] {
    return this.getStore().filter((m) => (m.type ?? "integration") === type);
  }

  /**
   * Install from GitHub — download pre-built tarball, verify SHA256 against
   * registry entry, enforce community-plugin confirmation, extract, register
   * in DB. Returns the manifest. Does NOT load the package (caller handles
   * that). See spec 089.
   */
  async installFromGitHub(repo: string, opts: InstallOptions = {}): Promise<PluginManifest> {
    this.logger.info({ repo }, "Installing package from GitHub");

    // Spec 089 C1: resolve registry entry up front. An install of a repo
    // absent from the registry is refused outright.
    const entry = this.getRegistryEntries().find((e) => e.repo === repo);
    if (!entry) {
      throw new Error(`Package not found in registry: ${repo}`);
    }
    if (!entry.sha256 || !SHA256_HEX.test(entry.sha256)) {
      throw new RegistryEntryInvalidError(entry.id, "sha256");
    }
    if (!isOfficial(entry) && !opts.confirmed) {
      const owner = entry.owner ?? entry.repo.split("/")[0] ?? "unknown";
      throw new CommunityPluginConfirmationRequiredError(entry.id, owner);
    }

    const tmpDir = resolve(this.pluginsDir, ".tmp");
    try {
      const extractDir = await this.downloadPrebuiltAsset(repo, tmpDir, entry);

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
   * Download files for a package that exists in DB but is missing on disk.
   * Used after backup restore — downloads tarball without modifying DB.
   * SHA256 is still verified; user already accepted the plugin at first
   * install so no community-confirm prompt is re-issued here.
   */
  async downloadMissing(repo: string): Promise<void> {
    const entry = this.getRegistryEntries().find((e) => e.repo === repo);
    if (!entry) {
      throw new Error(`Package not found in registry: ${repo}`);
    }
    if (!entry.sha256 || !SHA256_HEX.test(entry.sha256)) {
      throw new RegistryEntryInvalidError(entry.id, "sha256");
    }

    const tmpDir = resolve(this.pluginsDir, ".tmp");
    try {
      const extractDir = await this.downloadPrebuiltAsset(repo, tmpDir, entry);

      const manifestPath = resolve(extractDir, "manifest.json");
      if (!existsSync(manifestPath)) {
        throw new Error("Package archive does not contain manifest.json");
      }

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;

      const pkgDir = resolve(this.pluginsDir, manifest.id);
      if (existsSync(pkgDir)) {
        rmSync(pkgDir, { recursive: true });
      }
      await rename(extractDir, pkgDir);

      this.logger.info(
        { packageId: manifest.id, version: manifest.version },
        "Missing package downloaded",
      );
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

    // Spec 089 C1: re-resolve registry entry for the SHA256 (may have changed
    // since last install if the registry advances).
    const entry = this.getRegistryEntries().find((e) => e.repo === repo);
    if (!entry) {
      throw new Error(`Package not found in registry: ${repo}`);
    }
    if (!entry.sha256 || !SHA256_HEX.test(entry.sha256)) {
      throw new RegistryEntryInvalidError(entry.id, "sha256");
    }

    const tmpDir = resolve(this.pluginsDir, ".tmp");
    try {
      const extractDir = await this.downloadPrebuiltAsset(repo, tmpDir, entry);

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

  /** Read registry and return a map of packageId → latest version */
  getLatestVersions(): Map<string, string> {
    const versions = new Map<string, string>();
    for (const e of this.getRegistryEntries()) {
      if (e.version) versions.set(e.id, e.version);
    }
    return versions;
  }

  /** Lookup repo URL from registry */
  getRepoFromRegistry(packageId: string): string | undefined {
    return this.getRegistryEntries().find((e) => e.id === packageId)?.repo;
  }

  /**
   * Warm the registry cache by fetching the remote registry.
   * Must be called once at startup before any getStore()/getLatestVersions() calls.
   * Falls back to local file if remote is unreachable.
   */
  async warmRegistryCache(): Promise<void> {
    await this.fetchRemoteRegistry(false);
  }

  /**
   * Force refresh the remote registry, bypassing the CDN cache. Used by the
   * "Refresh" button on the Plugins page.
   */
  async refreshRegistryNow(): Promise<{ count: number; source: "remote" | "local" }> {
    const fetched = await this.fetchRemoteRegistry(true);
    return {
      count: this.registryCache?.length ?? 0,
      source: fetched ? "remote" : "local",
    };
  }

  /**
   * Internal: fetch registry.json from GitHub raw. When `force` is true, append
   * a cache-busting query string so we bypass the raw CDN's 5-min cache.
   */
  private async fetchRemoteRegistry(force: boolean): Promise<boolean> {
    // Force (manual Refresh) → Contents API, which is not behind raw's 5 min
    // CDN. Passive → raw (cached, no API rate-limit exposure). See issue #353.
    const url = force ? REGISTRY_API_URL : REGISTRY_URL;
    const headers: Record<string, string> = force
      ? { Accept: "application/vnd.github.raw" }
      : { Accept: "application/json" };
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const entries = (await res.json()) as RegistryEntry[];
        if (Array.isArray(entries) && entries.length > 0) {
          this.registryCache = entries;
          this.registryCacheTime = Date.now();
          this.logger.info({ count: entries.length, force }, "Remote registry loaded");
          return true;
        }
      }
      // On a forced refresh, if the API path fails (rate limit, outage), retry
      // once via raw before falling back to local — raw is usually only a few
      // minutes stale, still better than the on-disk snapshot.
      if (force) {
        const rawRes = await fetch(REGISTRY_URL, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (rawRes.ok) {
          const entries = (await rawRes.json()) as RegistryEntry[];
          if (Array.isArray(entries) && entries.length > 0) {
            this.registryCache = entries;
            this.registryCacheTime = Date.now();
            this.logger.info(
              { count: entries.length, force, via: "raw-fallback" },
              "Remote registry loaded",
            );
            return true;
          }
        }
      }
    } catch {
      // Remote unreachable — fall back to local
    }
    this.readLocalRegistry();
    this.logger.info({ count: this.registryCache?.length ?? 0 }, "Using local registry fallback");
    return false;
  }

  /**
   * Get registry entries from cache.
   * If cache is stale (>1h), trigger a background refresh and return stale data.
   */
  private getRegistryEntries(): RegistryEntry[] {
    if (this.registryCache && Date.now() - this.registryCacheTime < REGISTRY_CACHE_TTL_MS) {
      return this.registryCache;
    }

    // Trigger background refresh for next call
    this.refreshRegistryInBackground();

    // Return stale cache or local fallback
    if (this.registryCache) return this.registryCache;
    return this.readLocalRegistry();
  }

  private readLocalRegistry(): RegistryEntry[] {
    const registryPath = resolve(this.pluginsDir, "registry.json");
    if (!existsSync(registryPath)) return [];
    try {
      const entries = JSON.parse(readFileSync(registryPath, "utf-8")) as RegistryEntry[];
      this.registryCache = entries;
      this.registryCacheTime = Date.now();
      return entries;
    } catch {
      return [];
    }
  }

  private refreshRegistryInBackground(): void {
    fetch(REGISTRY_URL, { headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) return;
        const entries = (await res.json()) as RegistryEntry[];
        if (Array.isArray(entries) && entries.length > 0) {
          this.registryCache = entries;
          this.registryCacheTime = Date.now();
          this.logger.debug({ count: entries.length }, "Remote registry refreshed");
        }
      })
      .catch(() => {
        // Silently fall back to cache/local
      });
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  private async downloadPrebuiltAsset(
    repo: string,
    tmpDir: string,
    entry: RegistryEntry,
  ): Promise<string> {
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

    // ── SHA256 integrity check (spec 089 C1) ──────────────────
    const expected = entry.sha256!.toLowerCase();
    const actual = createHash("sha256").update(readFileSync(tarballPath)).digest("hex");
    if (actual !== expected) {
      try {
        rmSync(tarballPath);
      } catch {
        /* ignore */
      }
      this.logger.warn(
        { pluginId: entry.id, expected: expected.slice(0, 12), actual: actual.slice(0, 12) },
        "Plugin tarball SHA256 mismatch — refusing install",
      );
      throw new ChecksumMismatchError(entry.id, expected, actual);
    }
    this.logger.debug(
      { pluginId: entry.id, sha256: actual.slice(0, 12) },
      "Tarball SHA256 verified",
    );

    const extractDir = resolve(tmpDir, "extract");
    mkdirSync(extractDir, { recursive: true });

    // ── Tar extraction hardening (spec 089 C1) ────────────────
    // GNU tar strips leading slashes from absolute paths by default
    // ("Removing leading `/'" warning), so a tarball entry `/tmp/owned`
    // extracts to `<extract>/tmp/owned` — safe.
    // We add:
    //   --no-same-owner: don't preserve archive uid/gid (GNU only)
    //   --no-same-permissions: don't preserve archive mode bits (GNU only)
    // BSD tar (macOS dev) doesn't accept these flags. The defence-in-depth
    // symlink post-scan and path-prefix check still run on every platform.
    const tarFlags =
      process.platform === "linux" ? ["--no-same-owner", "--no-same-permissions"] : [];
    try {
      await execFile("tar", ["-xzf", tarballPath, "-C", extractDir, ...tarFlags]);
    } catch (err) {
      throw new Error(
        `Failed to extract tarball: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // ── Symlink post-extraction scan (spec 089 C1) ────────────
    // Refuse only symlinks that escape the extract dir (the real attack
    // vector — e.g. link → /etc/passwd or ../../sensitive). Internal
    // symlinks that point within the extracted tree are legitimate and
    // common (e.g. node_modules/.bin/* shipped by every npm package).
    this.assertNoEscapingSymlinks(extractDir, extractDir, entry.id);

    return extractDir;
  }

  /**
   * Walk a directory recursively. Throw SymlinkInTarballError if any
   * symlink's target resolves OUTSIDE the extract root (escape attempt).
   * Symlinks pointing within the root are allowed — npm packages
   * routinely ship node_modules/.bin/* symlinks like that.
   */
  private assertNoEscapingSymlinks(root: string, dir: string, pluginId: string): void {
    const rootAbs = resolve(root);
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = resolve(dir, e.name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(full);
        // Resolve target relative to the symlink's parent dir (POSIX semantics).
        const resolved = resolve(dir, target);
        if (resolved !== rootAbs && !resolved.startsWith(rootAbs + sep)) {
          // Best-effort cleanup before bailing.
          try {
            rmSync(root, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
          throw new SymlinkInTarballError(pluginId, relative(root, full));
        }
        // Internal symlink — safe, skip (don't recurse into it).
        continue;
      }
      if (e.isDirectory()) {
        this.assertNoEscapingSymlinks(root, full, pluginId);
      }
    }
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
