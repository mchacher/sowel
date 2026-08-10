import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { PluginSource } from "../shared/types.js";

/** "owner/repo" — GitHub login + repository name. */
const REPO_FORMAT = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

const RELEASE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour, same policy as the registry cache

/** Latest release of a personal source, as needed by the store and update checks. */
export interface PersonalRelease {
  /** Version derived from the release tag (leading "v" stripped). */
  version: string;
  assetName: string;
}

interface SourceRow {
  repo: string;
  added_at: string;
}

interface ReleaseCacheEntry {
  release: PersonalRelease | undefined;
  time: number;
}

/**
 * Personal plugin sources (spec 136) — GitHub repos added by an admin as
 * additional plugin sources, outside the central registry. Owns the
 * `plugin_sources` table and a cached view of each source's latest
 * GitHub release. Trust is TOFU-based and enforced by PackageManager;
 * this class only answers "which repos, which latest release".
 */
export class PersonalSourceManager {
  private db: Database.Database;
  private logger: Logger;
  private stmts: ReturnType<typeof this.prepareStatements>;
  private releaseCache = new Map<string, ReleaseCacheEntry>();
  private refreshing = new Set<string>();

  constructor(db: Database.Database, logger: Logger) {
    this.db = db;
    this.logger = logger.child({ module: "personal-sources" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      getAll: this.db.prepare("SELECT * FROM plugin_sources ORDER BY added_at"),
      getByRepo: this.db.prepare<[string]>("SELECT * FROM plugin_sources WHERE repo = ?"),
      insert: this.db.prepare(
        "INSERT INTO plugin_sources (repo, added_at) VALUES (@repo, @addedAt)",
      ),
      remove: this.db.prepare<[string]>("DELETE FROM plugin_sources WHERE repo = ?"),
    };
  }

  /** True if `repo` is a syntactically valid "owner/repo". */
  static isValidRepo(repo: string): boolean {
    return REPO_FORMAT.test(repo);
  }

  /** All sources, enriched with the cached latest release version (no network). */
  list(): PluginSource[] {
    const rows = this.stmts.getAll.all() as SourceRow[];
    return rows.map((row) => {
      const release = this.getCachedRelease(row.repo);
      return {
        repo: row.repo,
        addedAt: row.added_at,
        ...(release ? { latestVersion: release.version } : {}),
      };
    });
  }

  /** Membership test — the branch point for the personal install path. */
  has(repo: string): boolean {
    return !!this.stmts.getByRepo.get(repo);
  }

  /**
   * Add a source. Validates format and duplicates; the registry-overlap
   * check lives in PackageManager (which owns the registry view).
   * Probes the latest release best-effort so the caller can tell the
   * user whether the source is installable yet.
   */
  async add(repo: string): Promise<PluginSource> {
    if (!PersonalSourceManager.isValidRepo(repo)) {
      throw new Error(`Invalid repository format "${repo}" (expected owner/repo)`);
    }
    if (this.has(repo)) {
      throw new Error(`Source "${repo}" is already added`);
    }

    const addedAt = new Date().toISOString();
    this.stmts.insert.run({ repo, addedAt });
    this.logger.info({ repo }, "Personal source added");

    const release = await this.fetchLatestRelease(repo);
    return { repo, addedAt, ...(release ? { latestVersion: release.version } : {}) };
  }

  /** Remove a source. Installed packages from it are left untouched. */
  remove(repo: string): void {
    const result = this.stmts.remove.run(repo);
    if (result.changes === 0) {
      throw new Error(`Source "${repo}" is not in the list`);
    }
    this.releaseCache.delete(repo);
    this.logger.info({ repo }, "Personal source removed");
  }

  /**
   * Cached latest release for a source (sync). When the cache is stale,
   * returns the stale value and triggers a background refresh — same
   * pattern as the registry cache.
   */
  getCachedRelease(repo: string): PersonalRelease | undefined {
    const entry = this.releaseCache.get(repo);
    if (entry && Date.now() - entry.time < RELEASE_CACHE_TTL_MS) {
      return entry.release;
    }
    this.refreshInBackground(repo);
    return entry?.release;
  }

  /**
   * Drop the cached release for a repo and re-probe it in the
   * background. Called after an install or update: those paths download
   * `releases/latest` live, so once they succeed the cache — which may
   * still hold whatever release was current up to an hour ago — is known
   * to be behind reality. Leaving it in place makes the UI offer an
   * "update" to the older release the user just leapfrogged.
   */
  invalidate(repo: string): void {
    this.releaseCache.delete(repo);
    this.refreshInBackground(repo);
  }

  /**
   * Fetch the latest release of a repo from the GitHub API and update
   * the cache. Returns undefined (and keeps any previous cache entry
   * usable) on any failure — a missing release is a normal state for a
   * source added before its first publication.
   */
  async fetchLatestRelease(repo: string): Promise<PersonalRelease | undefined> {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn({ repo, status: res.status }, "Personal source release lookup failed");
        return undefined;
      }
      const release = (await res.json()) as {
        tag_name?: string;
        assets?: { name: string }[];
      };
      const asset = release.assets?.find(
        (a) => a.name.startsWith("sowel-") && a.name.endsWith(".tar.gz"),
      );
      if (!release.tag_name || !asset) {
        this.logger.warn(
          { repo, tag: release.tag_name ?? null },
          "Personal source release has no sowel-*.tar.gz asset",
        );
        this.releaseCache.set(repo, { release: undefined, time: Date.now() });
        return undefined;
      }
      const parsed: PersonalRelease = {
        version: release.tag_name.replace(/^v/, ""),
        assetName: asset.name,
      };
      this.releaseCache.set(repo, { release: parsed, time: Date.now() });
      return parsed;
    } catch (err) {
      this.logger.warn({ err, repo }, "Personal source release lookup error");
      return undefined;
    }
  }

  /** Refresh all sources' release info. `force` ignores the cache TTL. */
  async refreshAll(force = false): Promise<void> {
    const rows = this.stmts.getAll.all() as SourceRow[];
    for (const row of rows) {
      const entry = this.releaseCache.get(row.repo);
      if (!force && entry && Date.now() - entry.time < RELEASE_CACHE_TTL_MS) continue;
      await this.fetchLatestRelease(row.repo);
    }
  }

  private refreshInBackground(repo: string): void {
    if (this.refreshing.has(repo)) return;
    this.refreshing.add(repo);
    this.fetchLatestRelease(repo)
      .catch(() => {
        // Already logged in fetchLatestRelease.
      })
      .finally(() => {
        this.refreshing.delete(repo);
      });
  }
}
