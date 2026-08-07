// SECURITY: regression guards for spec 089 C1.
//
// These tests demonstrate that the plugin supply-chain attacks are blocked.
// Each test crafts a malicious situation (community plugin without consent,
// tampered tarball, missing checksum, symlink in archive) and asserts that
// install() refuses the operation.
//
// Per spec 089 methodology, these tests were written first to demonstrate
// the vulnerability on `main` (attack succeeds). After the fix, they assert
// the attack is blocked.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { PackageManager } from "./package-manager.js";
import {
  ChecksumMismatchError,
  CommunityPluginConfirmationRequiredError,
  RegistryEntryInvalidError,
  SymlinkInTarballError,
  isOfficial,
  type RegistryEntry,
} from "./registry-types.js";
import { createLogger } from "../core/logger.js";

const execFile = promisify(execFileCb);
const logger = createLogger("silent").logger;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(
    readFileSync(resolve(import.meta.dirname ?? ".", "../../migrations/001_initial.sql"), "utf-8"),
  );
  return db;
}

// ─── Build a real .tar.gz from a directory (uses system tar). ─────────────
async function buildTarball(srcDir: string, dest: string): Promise<void> {
  await execFile("tar", ["-czf", dest, "-C", srcDir, "."]);
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// ─── Helpers to install a tarball into a fake "GitHub release" mock. ──────
function mockGithubFetch(tarballPath: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://api.github.com/repos/")) {
        return new Response(
          JSON.stringify({
            tag_name: "v1.0.0",
            assets: [
              {
                name: "sowel-plugin-test-1.0.0.tar.gz",
                browser_download_url: "https://example.invalid/sowel-test.tar.gz",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.startsWith("https://example.invalid/")) {
        return new Response(readFileSync(tarballPath), {
          status: 200,
          headers: { "content-type": "application/gzip" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

describe("PackageManager — spec 089 C1 attack regression guards", () => {
  let tmpDir: string;
  let pluginsDir: string;
  let db: Database.Database;
  let manager: PackageManager;
  let pkgSrcDir: string;
  let tarballPath: string;
  let realSha256: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(resolve(tmpdir(), "sowel-pkg-test-"));
    pluginsDir = resolve(tmpDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    // PackageManager reads ./plugins relative to cwd
    process.chdir(tmpDir);

    db = createTestDb();
    manager = new PackageManager(db, logger);

    // Build a minimal valid plugin tarball: just a manifest.json inside.
    pkgSrcDir = resolve(tmpDir, "src-pkg");
    mkdirSync(pkgSrcDir, { recursive: true });
    writeFileSync(
      resolve(pkgSrcDir, "manifest.json"),
      JSON.stringify({
        id: "test-plugin",
        name: "Test Plugin",
        version: "1.0.0",
        description: "test",
        icon: "Puzzle",
        repo: "mchacher/sowel-plugin-test",
      }),
    );
    tarballPath = resolve(tmpDir, "test.tar.gz");
    await buildTarball(pkgSrcDir, tarballPath);
    realSha256 = sha256OfFile(tarballPath);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
    // Restore cwd BEFORE rmSync — otherwise the process is left with a
    // deleted directory as cwd, and any later process.cwd() call (e.g.
    // from the pino logger's worker thread) crashes with ENOENT/uv_cwd.
    try {
      process.chdir(originalCwd);
    } catch {
      /* best effort */
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Inject a registry entry into the in-memory cache. Bypasses fetch. */
  function setRegistry(entries: RegistryEntry[]): void {
    // The manager exposes no public setter — we reach into the cache fields
    // for test purposes only. Production code resets these on real fetch.
    (
      manager as unknown as { registryCache: RegistryEntry[]; registryCacheTime: number }
    ).registryCache = entries;
    (manager as unknown as { registryCacheTime: number }).registryCacheTime = Date.now();
  }

  // C1.5 — community plugin without confirmation
  it("refuses community plugin install without confirmed=true", async () => {
    setRegistry([
      {
        id: "test-plugin",
        name: "Test",
        description: "x",
        icon: "Puzzle",
        author: "third-party",
        repo: "third-party/sowel-plugin-test",
        owner: "third-party",
        sha256: realSha256,
        tags: [],
      },
    ]);
    mockGithubFetch(tarballPath);

    await expect(manager.installFromGitHub("third-party/sowel-plugin-test")).rejects.toBeInstanceOf(
      CommunityPluginConfirmationRequiredError,
    );
  });

  // C1.6 — community plugin with confirmed=true proceeds (positive case)
  it("allows community plugin install when confirmed=true", async () => {
    setRegistry([
      {
        id: "test-plugin",
        name: "Test",
        description: "x",
        icon: "Puzzle",
        author: "third-party",
        repo: "third-party/sowel-plugin-test",
        owner: "third-party",
        sha256: realSha256,
        tags: [],
      },
    ]);
    mockGithubFetch(tarballPath);

    const manifest = await manager.installFromGitHub("third-party/sowel-plugin-test", {
      confirmed: true,
    });
    expect(manifest.id).toBe("test-plugin");
  });

  // C1.2 — registry entry missing sha256 is refused
  it("refuses install when registry entry has no sha256", async () => {
    setRegistry([
      {
        id: "test-plugin",
        name: "Test",
        description: "x",
        icon: "Puzzle",
        author: "mchacher",
        repo: "mchacher/sowel-plugin-test",
        owner: "mchacher",
        tags: [],
      },
    ]);
    mockGithubFetch(tarballPath);

    await expect(manager.installFromGitHub("mchacher/sowel-plugin-test")).rejects.toBeInstanceOf(
      RegistryEntryInvalidError,
    );
  });

  // C1.1 — tarball SHA256 does not match registry → ChecksumMismatchError
  it("refuses install when downloaded tarball SHA256 does not match registry", async () => {
    setRegistry([
      {
        id: "test-plugin",
        name: "Test",
        description: "x",
        icon: "Puzzle",
        author: "mchacher",
        repo: "mchacher/sowel-plugin-test",
        owner: "mchacher",
        // Wrong hash — simulates a tampered tarball.
        sha256: "0".repeat(64),
        tags: [],
      },
    ]);
    mockGithubFetch(tarballPath);

    await expect(manager.installFromGitHub("mchacher/sowel-plugin-test")).rejects.toBeInstanceOf(
      ChecksumMismatchError,
    );
  });

  // C1.3 — tarball with a symlink that ESCAPES the extract dir is refused
  it("refuses install when tarball contains a symlink escaping the extract dir", async () => {
    // Absolute symlink → escapes any extract dir.
    const symlinkSrc = resolve(pkgSrcDir, "evil-link");
    symlinkSync("/etc/passwd", symlinkSrc);
    await buildTarball(pkgSrcDir, tarballPath);
    const newSha = sha256OfFile(tarballPath);

    setRegistry([
      {
        id: "test-plugin",
        name: "Test",
        description: "x",
        icon: "Puzzle",
        author: "mchacher",
        repo: "mchacher/sowel-plugin-test",
        owner: "mchacher",
        sha256: newSha,
        tags: [],
      },
    ]);
    mockGithubFetch(tarballPath);

    await expect(manager.installFromGitHub("mchacher/sowel-plugin-test")).rejects.toBeInstanceOf(
      SymlinkInTarballError,
    );
  });

  // C1.3b — tarball with a symlink ESCAPING via .. traversal is refused
  it("refuses install when tarball contains a symlink escaping via .. traversal", async () => {
    const symlinkSrc = resolve(pkgSrcDir, "evil-link");
    // Build a relative symlink with many .. so it always escapes regardless
    // of where the tarball is extracted (e.g. /tmp/extract/evil-link → /etc/passwd).
    symlinkSync("../../../../../../../../etc/passwd", symlinkSrc);
    await buildTarball(pkgSrcDir, tarballPath);
    const newSha = sha256OfFile(tarballPath);

    setRegistry([
      {
        id: "test-plugin",
        name: "Test",
        description: "x",
        icon: "Puzzle",
        author: "mchacher",
        repo: "mchacher/sowel-plugin-test",
        owner: "mchacher",
        sha256: newSha,
        tags: [],
      },
    ]);
    mockGithubFetch(tarballPath);

    await expect(manager.installFromGitHub("mchacher/sowel-plugin-test")).rejects.toBeInstanceOf(
      SymlinkInTarballError,
    );
  });

  // C1.3c — internal symlink (npm node_modules/.bin pattern) is ALLOWED
  it("allows install when tarball contains an internal symlink (e.g. node_modules/.bin)", async () => {
    // Mimic node_modules/.bin/foo → ../foo/bin.js (npm-installed package layout).
    const binDir = resolve(pkgSrcDir, "node_modules", ".bin");
    const targetDir = resolve(pkgSrcDir, "node_modules", "foo");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(resolve(targetDir, "bin.js"), "console.log('hi');\n");
    // Relative target pointing within the extract tree.
    symlinkSync("../foo/bin.js", resolve(binDir, "foo"));
    await buildTarball(pkgSrcDir, tarballPath);
    const newSha = sha256OfFile(tarballPath);

    setRegistry([
      {
        id: "test-plugin",
        name: "Test",
        description: "x",
        icon: "Puzzle",
        author: "mchacher",
        repo: "mchacher/sowel-plugin-test",
        owner: "mchacher",
        sha256: newSha,
        tags: [],
      },
    ]);
    mockGithubFetch(tarballPath);

    const manifest = await manager.installFromGitHub("mchacher/sowel-plugin-test");
    expect(manifest.id).toBe("test-plugin");
  });

  // C1 — package absent from registry is refused (not silently downloaded)
  it("refuses install when repo is not in registry", async () => {
    setRegistry([]);
    mockGithubFetch(tarballPath);

    await expect(manager.installFromGitHub("attacker/foreign-repo")).rejects.toThrow(
      /not found in registry/,
    );
  });
});

// Pure helper — no fixtures.
describe("registry-types.isOfficial", () => {
  it("returns true for an owner in OFFICIAL_OWNERS", () => {
    expect(
      isOfficial({
        id: "x",
        name: "x",
        description: "x",
        icon: "x",
        author: "mchacher",
        repo: "mchacher/foo",
        owner: "mchacher",
        sha256: "a".repeat(64),
        tags: [],
      }),
    ).toBe(true);
  });

  it("returns false for an owner outside OFFICIAL_OWNERS", () => {
    expect(
      isOfficial({
        id: "x",
        name: "x",
        description: "x",
        icon: "x",
        author: "third-party",
        repo: "third-party/foo",
        owner: "third-party",
        sha256: "a".repeat(64),
        tags: [],
      }),
    ).toBe(false);
  });

  it("derives owner from repo when missing", () => {
    expect(
      isOfficial({
        id: "x",
        name: "x",
        description: "x",
        icon: "x",
        author: "mchacher",
        repo: "mchacher/foo",
        sha256: "a".repeat(64),
        tags: [],
      }),
    ).toBe(true);
  });
});

describe("PackageManager — forced registry refresh (issue #353)", () => {
  let tmpDir: string;
  let db: Database.Database;
  let manager: PackageManager;
  let originalCwd: string;

  const REGISTRY = [
    {
      id: "smart-cooling",
      type: "recipe",
      name: "Smart Cooling",
      description: "x",
      icon: "Snowflake",
      author: "mchacher",
      repo: "mchacher/sowel-recipe-smart-cooling",
      version: "1.2.0",
      owner: "mchacher",
      sha256: "d".repeat(64),
      tags: [],
    },
  ];

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(resolve(tmpdir(), "sowel-pkg-refresh-"));
    mkdirSync(resolve(tmpDir, "plugins"), { recursive: true });
    process.chdir(tmpDir);
    db = createTestDb();
    manager = new PackageManager(db, logger);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
    try {
      process.chdir(originalCwd);
    } catch {
      /* best effort */
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("forced refresh fetches the Contents API, not the raw CDN", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = typeof input === "string" ? input : input.toString();
        urls.push(url);
        return new Response(JSON.stringify(REGISTRY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await manager.refreshRegistryNow();
    expect(result.source).toBe("remote");
    expect(result.count).toBe(1);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("api.github.com/repos/mchacher/sowel/contents/");
    expect(urls[0]).not.toContain("raw.githubusercontent.com");
  });

  it("falls back to raw when the Contents API fails on a forced refresh", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = typeof input === "string" ? input : input.toString();
        urls.push(url);
        if (url.includes("api.github.com")) {
          return new Response("rate limited", { status: 403 });
        }
        return new Response(JSON.stringify(REGISTRY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await manager.refreshRegistryNow();
    expect(result.source).toBe("remote");
    expect(result.count).toBe(1);
    expect(urls.some((u) => u.includes("api.github.com"))).toBe(true);
    expect(urls.some((u) => u.includes("raw.githubusercontent.com"))).toBe(true);
  });
});
