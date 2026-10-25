import { describe, it, expect, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { hotCopyDist } from "./hot-copy.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("silent").logger;

describe("hotCopyDist", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makePackage(): string {
    const dir = mkdtempSync(resolve(tmpdir(), "sowel-hot-"));
    tmpDirs.push(dir);
    mkdirSync(resolve(dir, "dist/lib"), { recursive: true });
    writeFileSync(resolve(dir, "dist/index.js"), "export {};");
    writeFileSync(resolve(dir, "dist/lib/helper.js"), "export const x = 1;");
    return dir;
  }

  it("copies the whole dist/ tree under .hot/", () => {
    const dir = makePackage();
    const hotDir = hotCopyDist(dir, logger);
    expect(hotDir.startsWith(resolve(dir, ".hot"))).toBe(true);
    expect(readFileSync(resolve(hotDir, "lib/helper.js"), "utf-8")).toBe("export const x = 1;");
  });

  it("gives every load its own directory, even within one millisecond", () => {
    // A reused directory would reuse its cached module URLs.
    vi.spyOn(Date, "now").mockReturnValue(4_000_000_000_000);
    const dir = makePackage();
    const first = hotCopyDist(dir, logger);
    const second = hotCopyDist(dir, logger);
    expect(second).not.toBe(first);
    expect(existsSync(resolve(second, "index.js"))).toBe(true);
  });

  it("keeps only the two newest copies", () => {
    const dir = makePackage();
    const copies = [1, 2, 3, 4].map(() => hotCopyDist(dir, logger));
    expect(readdirSync(resolve(dir, ".hot")).sort()).toEqual(
      copies
        .slice(-2)
        .map((p) => p.split("/").pop())
        .sort(),
    );
    expect(existsSync(copies[0])).toBe(false);
  });

  it("never prunes the copy it just made, even behind stamps from the future", () => {
    // A clock that ran ahead left two later stamps behind.
    const dir = makePackage();
    mkdirSync(resolve(dir, ".hot/9999999999998"), { recursive: true });
    mkdirSync(resolve(dir, ".hot/9999999999999"), { recursive: true });
    const hotDir = hotCopyDist(dir, logger);
    expect(existsSync(resolve(hotDir, "index.js"))).toBe(true);
    expect(readdirSync(resolve(dir, ".hot"))).toHaveLength(2);
  });

  it("leaves non-numeric entries in .hot/ alone", () => {
    const dir = makePackage();
    mkdirSync(resolve(dir, ".hot/keep-me"), { recursive: true });
    for (let i = 0; i < 3; i++) hotCopyDist(dir, logger);
    expect(existsSync(resolve(dir, ".hot/keep-me"))).toBe(true);
  });

  it("throws when the package has no dist/", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "sowel-hot-"));
    tmpDirs.push(dir);
    expect(() => hotCopyDist(dir, logger)).toThrow(/dist directory not found/);
  });
});
