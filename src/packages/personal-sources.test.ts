// Spec 136 — PersonalSourceManager unit tests: source CRUD, release
// lookup, cache behaviour. The TOFU install/update flows are covered in
// package-manager.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PersonalSourceManager, type PersonalRelease } from "./personal-sources.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("silent").logger;
const REPO = "jdupont/sowel-recipe-myrecipe";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(
    readFileSync(resolve(import.meta.dirname ?? ".", "../../migrations/001_initial.sql"), "utf-8"),
  );
  db.exec(
    readFileSync(
      resolve(import.meta.dirname ?? ".", "../../migrations/015_plugin_sources.sql"),
      "utf-8",
    ),
  );
  return db;
}

function mockReleaseFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const RELEASE_OK = {
  tag_name: "v1.2.0",
  assets: [{ name: "sowel-recipe-myrecipe-1.2.0.tar.gz" }],
};

describe("PersonalSourceManager", () => {
  let db: Database.Database;
  let sources: PersonalSourceManager;

  beforeEach(() => {
    db = createTestDb();
    sources = new PersonalSourceManager(db, logger);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  describe("repo validation", () => {
    it.each(["owner/repo", "a-b/c.d_e", "Jdupont/sowel-plugin-X"])("accepts %s", (repo) => {
      expect(PersonalSourceManager.isValidRepo(repo)).toBe(true);
    });

    it.each([
      "no-slash",
      "owner/repo/extra",
      "https://github.com/owner/repo",
      "owner/../etc",
      "owner/re po",
      "",
    ])("rejects %s", (repo) => {
      expect(PersonalSourceManager.isValidRepo(repo)).toBe(false);
    });
  });

  describe("add / remove / list", () => {
    it("adds a valid source and returns the latest release version", async () => {
      mockReleaseFetch(RELEASE_OK);
      const source = await sources.add(REPO);
      expect(source.repo).toBe(REPO);
      expect(source.latestVersion).toBe("1.2.0");
      expect(sources.has(REPO)).toBe(true);
      expect(sources.list()).toHaveLength(1);
    });

    it("adds a source even when it has no release yet (warn, not refuse)", async () => {
      mockReleaseFetch({ message: "Not Found" }, 404);
      const source = await sources.add(REPO);
      expect(source.repo).toBe(REPO);
      expect(source.latestVersion).toBeUndefined();
      expect(sources.has(REPO)).toBe(true);
    });

    it("rejects an invalid format without inserting", async () => {
      mockReleaseFetch(RELEASE_OK);
      await expect(sources.add("bad format")).rejects.toThrow(/Invalid repository/);
      expect(sources.list()).toHaveLength(0);
    });

    it("rejects a duplicate", async () => {
      mockReleaseFetch(RELEASE_OK);
      await sources.add(REPO);
      await expect(sources.add(REPO)).rejects.toThrow(/already added/);
      expect(sources.list()).toHaveLength(1);
    });

    it("removes a source and throws on unknown repo", async () => {
      mockReleaseFetch(RELEASE_OK);
      await sources.add(REPO);
      sources.remove(REPO);
      expect(sources.has(REPO)).toBe(false);
      expect(() => sources.remove(REPO)).toThrow(/not in the list/);
    });
  });

  describe("release lookup", () => {
    it("returns undefined when the release has no sowel-*.tar.gz asset", async () => {
      mockReleaseFetch({ tag_name: "v1.0.0", assets: [{ name: "random.zip" }] });
      const release = await sources.fetchLatestRelease(REPO);
      expect(release).toBeUndefined();
    });

    it("returns undefined on API error without throwing", async () => {
      mockReleaseFetch({ message: "rate limited" }, 403);
      await expect(sources.fetchLatestRelease(REPO)).resolves.toBeUndefined();
    });

    it("returns undefined on network error without throwing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      );
      await expect(sources.fetchLatestRelease(REPO)).resolves.toBeUndefined();
    });

    it("strips the leading v from the release tag", async () => {
      mockReleaseFetch(RELEASE_OK);
      const release = await sources.fetchLatestRelease(REPO);
      expect(release?.version).toBe("1.2.0");
    });
  });

  describe("release cache", () => {
    it("serves the cache within the TTL without re-fetching", async () => {
      const mock = mockReleaseFetch(RELEASE_OK);
      await sources.fetchLatestRelease(REPO);
      expect(mock).toHaveBeenCalledTimes(1);

      expect(sources.getCachedRelease(REPO)?.version).toBe("1.2.0");
      expect(sources.getCachedRelease(REPO)?.version).toBe("1.2.0");
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it("serves the stale value and refreshes in background after the TTL", async () => {
      const mock = mockReleaseFetch(RELEASE_OK);
      await sources.fetchLatestRelease(REPO);

      // Age the cache entry past the TTL.
      const cache = (
        sources as unknown as {
          releaseCache: Map<string, { release?: PersonalRelease; time: number }>;
        }
      ).releaseCache;
      cache.get(REPO)!.time = Date.now() - 2 * 60 * 60 * 1000;

      // Stale read still returns the old value, a background refresh fires.
      expect(sources.getCachedRelease(REPO)?.version).toBe("1.2.0");
      await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    });

    it("refreshAll(force) re-fetches every source", async () => {
      const mock = mockReleaseFetch(RELEASE_OK);
      await sources.add(REPO);
      expect(mock).toHaveBeenCalledTimes(1);
      await sources.refreshAll(true);
      expect(mock).toHaveBeenCalledTimes(2);
      // Non-forced within TTL: no extra call.
      await sources.refreshAll(false);
      expect(mock).toHaveBeenCalledTimes(2);
    });
  });
});
