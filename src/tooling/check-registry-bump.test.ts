import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Issue #892 — scripts/check-registry-bump.sh is a shell gate, not part of the
// TS build, but the backend suite is the only place vitest looks
// (`src/**/*.test.ts`), so its test lives here, next to the specs-index one.
//
// Each case builds a throwaway git repository holding a registry, plus a
// directory of real tarballs the script reads through SOWEL_REGISTRY_ASSET_DIR
// instead of downloading from GitHub. Everything else — the diff against the
// merge base, the hashing, the manifest read inside the tarball — is the real
// script doing the real thing.

const SCRIPT = resolve(import.meta.dirname, "../../scripts/check-registry-bump.sh");

interface Entry {
  id: string;
  type: string;
  name: string;
  repo: string;
  version: string;
  owner: string;
  sha256: string;
}

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "acme",
    type: "integration",
    name: "Acme",
    repo: "mchacher/sowel-plugin-acme",
    version: "1.0.0",
    owner: "mchacher",
    sha256: "0".repeat(64),
    ...over,
  };
}

describe("scripts/check-registry-bump.sh (spec 089, issue #892)", () => {
  let dir: string;
  let assets: string;

  function git(...args: string[]): void {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  }

  /** Writes the registry and commits it, so each call is one revision. */
  function commitRegistry(entries: Entry[], message: string): void {
    mkdirSync(join(dir, "plugins"), { recursive: true });
    writeFileSync(join(dir, "plugins", "registry.json"), JSON.stringify(entries, null, 2));
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", message);
  }

  /**
   * Builds the tarball a release workflow would publish and returns its SHA256,
   * so a test can put the true hash in the registry or deliberately not.
   */
  function publishAsset(opts: {
    id: string;
    version: string;
    type?: string;
    manifestId?: string;
    manifestVersion?: string;
  }): string {
    const prefix = opts.type === "recipe" ? "sowel-recipe" : "sowel-plugin";
    const name = `${prefix}-${opts.id}-${opts.version}.tar.gz`;
    const staging = mkdtempSync(join(tmpdir(), "registry-asset-"));
    writeFileSync(
      join(staging, "manifest.json"),
      JSON.stringify({
        id: opts.manifestId ?? opts.id,
        version: opts.manifestVersion ?? opts.version,
        type: opts.type ?? "integration",
      }),
    );
    execFileSync("tar", ["czf", join(assets, name), "-C", staging, "manifest.json"]);
    rmSync(staging, { recursive: true, force: true });
    return createHash("sha256")
      .update(readFileSync(join(assets, name)))
      .digest("hex");
  }

  function run(baseRef = "HEAD~1"): { status: number; out: string } {
    try {
      const stdout = execFileSync("bash", [SCRIPT, baseRef], {
        cwd: dir,
        encoding: "utf-8",
        env: { ...process.env, SOWEL_REGISTRY_ASSET_DIR: assets },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, out: stdout };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { status: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "registry-bump-"));
    assets = mkdtempSync(join(tmpdir(), "registry-assets-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    commitRegistry([entry({ sha256: "a".repeat(64) })], "base");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(assets, { recursive: true, force: true });
  });

  it("passes when the bumped entry matches its published asset", () => {
    const sha = publishAsset({ id: "acme", version: "1.1.0" });
    commitRegistry([entry({ version: "1.1.0", sha256: sha })], "bump");

    const res = run();

    expect(res.status).toBe(0);
    expect(res.out).toContain("✓ acme 1.1.0");
    expect(res.out).toContain("Every changed registry entry matches its published release");
  });

  it("fails on a hash that is not the asset's, and prints both", () => {
    const sha = publishAsset({ id: "acme", version: "1.1.0" });
    commitRegistry([entry({ version: "1.1.0", sha256: "b".repeat(64) })], "bump with stale hash");

    const res = run();

    expect(res.status).toBe(1);
    expect(res.out).toContain("sha256 does not match the published asset");
    expect(res.out).toContain(sha);
    expect(res.out).toContain("backfill-registry-sha256.mjs");
  });

  it("fails when no asset exists for the declared version", () => {
    publishAsset({ id: "acme", version: "1.0.0" });
    commitRegistry([entry({ version: "1.1.0", sha256: "b".repeat(64) })], "bump ahead of release");

    const res = run();

    expect(res.status).toBe(1);
    expect(res.out).toContain("sowel-plugin-acme-1.1.0.tar.gz");
  });

  it("fails when the hash is right but the tarball is another release", () => {
    // The asset is genuine and the hash is its hash: only the manifest inside
    // says otherwise, which is what pointing an entry at the wrong tag does.
    const sha = publishAsset({ id: "acme", version: "1.1.0", manifestVersion: "1.0.9" });
    commitRegistry([entry({ version: "1.1.0", sha256: sha })], "bump to the wrong tag");

    const res = run();

    expect(res.status).toBe(1);
    expect(res.out).toContain("the tarball is not the release this entry claims");
    expect(res.out).toContain("manifest version is '1.0.9', registry says '1.1.0'");
  });

  it("verifies a recipe entry through its own asset name", () => {
    const sha = publishAsset({ id: "watering", version: "2.0.0", type: "recipe" });
    commitRegistry(
      [
        entry({ sha256: "a".repeat(64) }),
        entry({
          id: "watering",
          type: "recipe",
          name: "Watering",
          repo: "mchacher/sowel-recipe-watering",
          version: "2.0.0",
          sha256: sha,
        }),
      ],
      "add a recipe",
    );

    const res = run();

    expect(res.status).toBe(0);
    expect(res.out).toContain("✓ watering 2.0.0");
  });

  it("skips when the pull request does not touch the registry", () => {
    writeFileSync(join(dir, "README.md"), "hello\n");
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "docs");

    const res = run();

    expect(res.status).toBe(0);
    expect(res.out).toContain("bump integrity check skipped");
  });

  it("does not download anything when only the prose of an entry changed", () => {
    commitRegistry([entry({ sha256: "a".repeat(64), name: "Acme Renamed" })], "rename");

    const res = run();

    expect(res.status).toBe(0);
    expect(res.out).toContain("no version or sha256 changed");
  });

  it("rejects an entry that breaks the spec 089 contract, touched or not", () => {
    commitRegistry([entry({ version: "1.1.0", sha256: "abc" })], "truncated hash");

    const res = run();

    expect(res.status).toBe(1);
    expect(res.out).toContain("sha256 is not 64 hex characters");
  });
});
