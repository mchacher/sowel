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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { PackageManager } from "./package-manager.js";
import {
  ChecksumMismatchError,
  CommunityPluginConfirmationRequiredError,
  PersonalPluginConfirmationRequiredError,
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
  // Spec 136 — plugin_sources table + plugins.source/pinned_sha256 columns.
  db.exec(
    readFileSync(
      resolve(import.meta.dirname ?? ".", "../../migrations/015_plugin_sources.sql"),
      "utf-8",
    ),
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

// ─── Spec 136 — Personal plugin sources (TOFU trust model) ────────────────

describe("PackageManager — spec 136 personal plugin sources", () => {
  const PERSONAL_REPO = "jdupont/sowel-plugin-mytest";

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
    tmpDir = mkdtempSync(resolve(tmpdir(), "sowel-pkg-personal-"));
    pluginsDir = resolve(tmpDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    process.chdir(tmpDir);

    db = createTestDb();
    manager = new PackageManager(db, logger);
    setRegistry([]);

    pkgSrcDir = resolve(tmpDir, "src-pkg");
    mkdirSync(pkgSrcDir, { recursive: true });
    writePersonalManifest({});
    tarballPath = resolve(tmpDir, "personal.tar.gz");
    await buildTarball(pkgSrcDir, tarballPath);
    realSha256 = sha256OfFile(tarballPath);
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

  function setRegistry(entries: RegistryEntry[]): void {
    (
      manager as unknown as { registryCache: RegistryEntry[]; registryCacheTime: number }
    ).registryCache = entries;
    (manager as unknown as { registryCacheTime: number }).registryCacheTime = Date.now();
  }

  function writePersonalManifest(overrides: Record<string, unknown>): void {
    writeFileSync(
      resolve(pkgSrcDir, "manifest.json"),
      JSON.stringify({
        id: "mytest",
        name: "My Test Plugin",
        version: "1.0.0",
        description: "personal test plugin",
        icon: "Puzzle",
        repo: PERSONAL_REPO,
        ...overrides,
      }),
    );
  }

  /** Mock GitHub API + asset download for the personal repo. */
  function mockPersonalFetch(assetPath: string, tag = "v1.0.0"): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith("https://api.github.com/repos/")) {
          return new Response(
            JSON.stringify({
              tag_name: tag,
              assets: [
                {
                  name: `sowel-plugin-mytest-${tag.replace(/^v/, "")}.tar.gz`,
                  browser_download_url: "https://example.invalid/personal.tar.gz",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.startsWith("https://example.invalid/")) {
          return new Response(readFileSync(assetPath), {
            status: 200,
            headers: { "content-type": "application/gzip" },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  }

  function getRow(
    id: string,
  ): { source: string; pinned_sha256: string | null; version: string } | undefined {
    return db.prepare("SELECT source, pinned_sha256, version FROM plugins WHERE id = ?").get(id) as
      | { source: string; pinned_sha256: string | null; version: string }
      | undefined;
  }

  async function addSourceAndInstall(): Promise<void> {
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    await manager.installFromGitHub(PERSONAL_REPO, {
      confirmed: true,
      expectedSha256: realSha256,
    });
  }

  // ── Source management ─────────────────────────────────────────

  it("refuses adding a source with an invalid repo format", async () => {
    mockPersonalFetch(tarballPath);
    await expect(manager.addPersonalSource("not-a-repo")).rejects.toThrow(/Invalid repository/);
    await expect(manager.addPersonalSource("owner/repo/extra")).rejects.toThrow(
      /Invalid repository/,
    );
    expect(manager.listPersonalSources()).toHaveLength(0);
  });

  it("refuses adding a duplicate source", async () => {
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    await expect(manager.addPersonalSource(PERSONAL_REPO)).rejects.toThrow(/already added/);
    expect(manager.listPersonalSources()).toHaveLength(1);
  });

  it("refuses adding a repo that is already in the plugin registry", async () => {
    setRegistry([
      {
        id: "mytest",
        name: "x",
        description: "x",
        icon: "x",
        author: "jdupont",
        repo: PERSONAL_REPO,
        owner: "jdupont",
        sha256: "a".repeat(64),
        tags: [],
      },
    ]);
    mockPersonalFetch(tarballPath);
    await expect(manager.addPersonalSource(PERSONAL_REPO)).rejects.toThrow(
      /already in the plugin registry/,
    );
  });

  it("removes a source and refuses removing an unknown one", async () => {
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    manager.removePersonalSource(PERSONAL_REPO);
    expect(manager.listPersonalSources()).toHaveLength(0);
    expect(() => manager.removePersonalSource(PERSONAL_REPO)).toThrow(/not in the list/);
  });

  // ── TOFU install ──────────────────────────────────────────────

  it("unconfirmed personal install throws with version + sha256 and writes nothing", async () => {
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);

    let thrown: unknown;
    try {
      await manager.installFromGitHub(PERSONAL_REPO);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PersonalPluginConfirmationRequiredError);
    const e = thrown as PersonalPluginConfirmationRequiredError;
    expect(e.repo).toBe(PERSONAL_REPO);
    expect(e.owner).toBe("jdupont");
    expect(e.version).toBe("1.0.0");
    expect(e.sha256).toBe(realSha256);

    expect(getRow("mytest")).toBeUndefined();
    expect(existsSync(resolve(pluginsDir, "mytest"))).toBe(false);
    expect(existsSync(resolve(pluginsDir, ".tmp"))).toBe(false);
  });

  it("confirmed personal install without expectedSha256 is refused", async () => {
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    await expect(manager.installFromGitHub(PERSONAL_REPO, { confirmed: true })).rejects.toThrow(
      /expectedSha256/,
    );
    expect(getRow("mytest")).toBeUndefined();
  });

  it("confirmed personal install with a drifted tarball hash is refused", async () => {
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    await expect(
      manager.installFromGitHub(PERSONAL_REPO, { confirmed: true, expectedSha256: "0".repeat(64) }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(getRow("mytest")).toBeUndefined();
    expect(existsSync(resolve(pluginsDir, "mytest"))).toBe(false);
  });

  it("confirmed personal install pins the hash and marks source=personal", async () => {
    await addSourceAndInstall();

    const row = getRow("mytest");
    expect(row).toBeDefined();
    expect(row!.source).toBe("personal");
    expect(row!.pinned_sha256).toBe(realSha256);
    expect(row!.version).toBe("1.0.0");
    expect(existsSync(resolve(pluginsDir, "mytest", "manifest.json"))).toBe(true);
  });

  it("refuses a personal package whose id shadows a registry entry", async () => {
    setRegistry([
      {
        id: "mytest",
        name: "Official mytest",
        description: "x",
        icon: "x",
        author: "mchacher",
        repo: "mchacher/sowel-plugin-mytest",
        owner: "mchacher",
        sha256: "a".repeat(64),
        tags: [],
      },
    ]);
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    await expect(
      manager.installFromGitHub(PERSONAL_REPO, { confirmed: true, expectedSha256: realSha256 }),
    ).rejects.toThrow(/shadows a plugin registry entry/);
    expect(getRow("mytest")).toBeUndefined();
  });

  it("refuses a personal package whose manifest declares a different repo", async () => {
    writePersonalManifest({ repo: "mchacher/sowel-plugin-zigbee2mqtt" });
    await buildTarball(pkgSrcDir, tarballPath);
    const sha = sha256OfFile(tarballPath);
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    await expect(
      manager.installFromGitHub(PERSONAL_REPO, { confirmed: true, expectedSha256: sha }),
    ).rejects.toThrow(/declares repo/);
    expect(getRow("mytest")).toBeUndefined();
  });

  it("refuses a personal package with an incompatible sowelVersion", async () => {
    // Test cwd has no package.json → current version resolves to 0.0.0.
    writePersonalManifest({ sowelVersion: ">=99.0.0" });
    await buildTarball(pkgSrcDir, tarballPath);
    const sha = sha256OfFile(tarballPath);
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    await expect(
      manager.installFromGitHub(PERSONAL_REPO, { confirmed: true, expectedSha256: sha }),
    ).rejects.toThrow(/requires Sowel/);
    expect(getRow("mytest")).toBeUndefined();
  });

  it("refuses a personal tarball containing an escaping symlink", async () => {
    symlinkSync("/etc/passwd", resolve(pkgSrcDir, "evil-link"));
    await buildTarball(pkgSrcDir, tarballPath);
    const sha = sha256OfFile(tarballPath);
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    await expect(
      manager.installFromGitHub(PERSONAL_REPO, { confirmed: true, expectedSha256: sha }),
    ).rejects.toBeInstanceOf(SymlinkInTarballError);
  });

  it("still refuses a repo that is neither in registry nor in sources (spec 089 regression)", async () => {
    mockPersonalFetch(tarballPath);
    await expect(manager.installFromGitHub("attacker/foreign-repo")).rejects.toThrow(
      /not found in registry/,
    );
  });

  it("registry install keeps source=registry and no pinned hash (regression)", async () => {
    setRegistry([
      {
        id: "mytest",
        name: "Test",
        description: "x",
        icon: "Puzzle",
        author: "mchacher",
        repo: PERSONAL_REPO,
        owner: "mchacher",
        sha256: realSha256,
        tags: [],
      },
    ]);
    mockPersonalFetch(tarballPath);
    await manager.installFromGitHub(PERSONAL_REPO);
    const row = getRow("mytest");
    expect(row!.source).toBe("registry");
    expect(row!.pinned_sha256).toBeNull();
  });

  // ── TOFU update ───────────────────────────────────────────────

  async function publishV2(): Promise<{ tarball: string; sha: string }> {
    writePersonalManifest({ version: "2.0.0" });
    const v2Tarball = resolve(tmpDir, "personal-v2.tar.gz");
    await buildTarball(pkgSrcDir, v2Tarball);
    mockPersonalFetch(v2Tarball, "v2.0.0");
    return { tarball: v2Tarball, sha: sha256OfFile(v2Tarball) };
  }

  it("unconfirmed personal update with new content throws with the new hash, files untouched", async () => {
    await addSourceAndInstall();
    const v2 = await publishV2();

    let thrown: unknown;
    try {
      await manager.updateFiles("mytest");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PersonalPluginConfirmationRequiredError);
    const e = thrown as PersonalPluginConfirmationRequiredError;
    expect(e.version).toBe("2.0.0");
    expect(e.sha256).toBe(v2.sha);

    const row = getRow("mytest");
    expect(row!.version).toBe("1.0.0");
    expect(row!.pinned_sha256).toBe(realSha256);
  });

  it("confirmed personal update replaces files and re-pins the hash", async () => {
    await addSourceAndInstall();
    const v2 = await publishV2();

    const manifest = await manager.updateFiles("mytest", {
      confirmed: true,
      expectedSha256: v2.sha,
    });
    expect(manifest.version).toBe("2.0.0");

    const row = getRow("mytest");
    expect(row!.version).toBe("2.0.0");
    expect(row!.pinned_sha256).toBe(v2.sha);
  });

  it("unconfirmed personal update with unchanged content proceeds without confirmation", async () => {
    await addSourceAndInstall();
    // Same tarball still served — content identical to the pinned hash.
    const manifest = await manager.updateFiles("mytest");
    expect(manifest.version).toBe("1.0.0");
    expect(getRow("mytest")!.pinned_sha256).toBe(realSha256);
  });

  it("refuses a personal update after the source has been removed", async () => {
    await addSourceAndInstall();
    manager.removePersonalSource(PERSONAL_REPO);
    await expect(manager.updateFiles("mytest")).rejects.toThrow(/has been removed/);
    await expect(manager.probePersonalUpdate("mytest")).rejects.toThrow(/has been removed/);
  });

  it("probePersonalUpdate is a no-op for registry packages and confirmed calls", async () => {
    await addSourceAndInstall();
    await publishV2();
    // Confirmed → no probe, no throw.
    await expect(
      manager.probePersonalUpdate("mytest", { confirmed: true }),
    ).resolves.toBeUndefined();
    // Unconfirmed with new content → throws.
    await expect(manager.probePersonalUpdate("mytest")).rejects.toBeInstanceOf(
      PersonalPluginConfirmationRequiredError,
    );
    // Unknown package → no-op.
    await expect(manager.probePersonalUpdate("nope")).resolves.toBeUndefined();
  });

  // ── Backup restore path ───────────────────────────────────────

  it("downloadMissing restores a personal package against the pinned hash", async () => {
    await addSourceAndInstall();
    rmSync(resolve(pluginsDir, "mytest"), { recursive: true });

    await manager.downloadMissing(PERSONAL_REPO);
    expect(existsSync(resolve(pluginsDir, "mytest", "manifest.json"))).toBe(true);
  });

  it("downloadMissing refuses a personal package when the tarball drifted from the pinned hash", async () => {
    await addSourceAndInstall();
    rmSync(resolve(pluginsDir, "mytest"), { recursive: true });

    // Republished tarball under the same tag — content no longer matches.
    writePersonalManifest({ description: "tampered" });
    const tampered = resolve(tmpDir, "tampered.tar.gz");
    await buildTarball(pkgSrcDir, tampered);
    mockPersonalFetch(tampered);

    await expect(manager.downloadMissing(PERSONAL_REPO)).rejects.toBeInstanceOf(
      ChecksumMismatchError,
    );
    expect(existsSync(resolve(pluginsDir, "mytest"))).toBe(false);
  });

  it("downloadMissing still refuses an unknown repo (spec 089 regression)", async () => {
    mockPersonalFetch(tarballPath);
    await expect(manager.downloadMissing("attacker/foreign-repo")).rejects.toThrow(
      /not found in registry/,
    );
  });

  // ── Store merge ───────────────────────────────────────────────

  it("getStore merges personal entries with tier=personal and excludes installed repos", async () => {
    setRegistry([
      {
        id: "official-one",
        name: "Official",
        description: "x",
        icon: "x",
        author: "mchacher",
        repo: "mchacher/sowel-plugin-official-one",
        owner: "mchacher",
        sha256: "a".repeat(64),
        tags: [],
      },
      {
        id: "community-one",
        name: "Community",
        description: "x",
        icon: "x",
        author: "third",
        repo: "third/sowel-plugin-community-one",
        owner: "third",
        sha256: "b".repeat(64),
        tags: [],
      },
    ]);
    mockPersonalFetch(tarballPath);
    await manager.addPersonalSource(PERSONAL_REPO);
    // Warm the release cache so the sync store synthesis sees the release.
    await manager.sources.fetchLatestRelease(PERSONAL_REPO);

    const store = manager.getStore();
    const tiers = new Map(store.map((e) => [e.id, e.tier]));
    expect(tiers.get("official-one")).toBe("official");
    expect(tiers.get("community-one")).toBe("community");
    expect(tiers.get(PERSONAL_REPO)).toBe("personal");

    const personal = store.find((e) => e.id === PERSONAL_REPO)!;
    expect(personal.name).toBe("mytest");
    expect(personal.version).toBe("1.0.0");
    expect(personal.author).toBe("jdupont");
    expect(personal.type).toBe("integration");

    // Install it — the personal store entry must disappear.
    await manager.installFromGitHub(PERSONAL_REPO, {
      confirmed: true,
      expectedSha256: realSha256,
    });
    expect(manager.getStore().find((e) => e.id === PERSONAL_REPO)).toBeUndefined();
  });

  it("getLatestVersionFor reads the source release for personal packages, registry for others", async () => {
    await addSourceAndInstall();
    await publishV2();
    await manager.sources.fetchLatestRelease(PERSONAL_REPO);

    const pkg = manager.getById("mytest")!;
    expect(pkg.source).toBe("personal");
    expect(manager.getLatestVersionFor(pkg)).toBe("2.0.0");
  });
});
