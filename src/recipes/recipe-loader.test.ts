import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { RecipeLoader } from "./recipe-loader.js";
import { createLogger } from "../core/logger.js";
import type { PackageManager } from "../packages/package-manager.js";
import type { RecipeManager } from "./engine/recipe-manager.js";

const logger = createLogger("silent").logger;

/** Minimal PackageManager stub with only the methods RecipeLoader calls. */
function makePackageManager(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    installFromGitHub: vi.fn(),
    probePersonalUpdate: vi.fn(async () => undefined),
    updateFiles: vi.fn(),
    getInstalledByType: vi.fn(() => []),
    getPackageDir: vi.fn((id: string) => `/nonexistent/${id}`),
    downloadMissing: vi.fn(),
    ...overrides,
  } as unknown as PackageManager;
}

function makeRecipeManager() {
  return {
    registerExternal: vi.fn(),
    restartInstancesOfRecipe: vi.fn(() => 2),
  } as unknown as RecipeManager;
}

/** Write a temp recipe package exposing dist/index.js with a createRecipe export. */
function writeRecipePackage(exportName: "named" | "default" | "none"): string {
  const dir = mkdtempSync(resolve(tmpdir(), "sowel-recipe-"));
  mkdirSync(resolve(dir, "dist"), { recursive: true });
  const body =
    exportName === "named"
      ? `export function createRecipe() { return { id: "temp-recipe", name: "Temp" }; }`
      : exportName === "default"
        ? `export default { createRecipe() { return { id: "temp-recipe", name: "Temp" }; } };`
        : `export const nothing = true;`;
  writeFileSync(resolve(dir, "dist/index.js"), body);
  return dir;
}

describe("RecipeLoader", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("install", () => {
    it("rejects a package whose manifest type is not 'recipe'", async () => {
      const pm = makePackageManager({
        installFromGitHub: vi.fn(async () => ({ id: "pkg", type: "integration" })),
      });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await expect(loader.install("owner/repo")).rejects.toThrow(/is not a recipe/);
      expect(rm.registerExternal).not.toHaveBeenCalled();
    });

    it("loads and registers a valid recipe after install", async () => {
      const dir = writeRecipePackage("named");
      tmpDirs.push(dir);
      const pm = makePackageManager({
        installFromGitHub: vi.fn(async () => ({ id: "temp-recipe", type: "recipe" })),
        getPackageDir: vi.fn(() => dir),
      });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await loader.install("owner/repo");
      expect(rm.registerExternal).toHaveBeenCalledWith({ id: "temp-recipe", name: "Temp" });
    });
  });

  describe("loadNewlyInstalled", () => {
    it("swallows a load failure (package stays installed, retried at next boot)", async () => {
      const pm = makePackageManager(); // getPackageDir → /nonexistent → entry missing
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await expect(loader.loadNewlyInstalled("ghost")).resolves.toBeUndefined();
      expect(rm.registerExternal).not.toHaveBeenCalled();
    });

    it("accepts a package exposing createRecipe via a default export", async () => {
      const dir = writeRecipePackage("default");
      tmpDirs.push(dir);
      const pm = makePackageManager({ getPackageDir: vi.fn(() => dir) });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await loader.loadNewlyInstalled("temp-recipe");
      expect(rm.registerExternal).toHaveBeenCalledOnce();
    });

    it("does not register a package missing the createRecipe export", async () => {
      const dir = writeRecipePackage("none");
      tmpDirs.push(dir);
      const pm = makePackageManager({ getPackageDir: vi.fn(() => dir) });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await loader.loadNewlyInstalled("temp-recipe");
      expect(rm.registerExternal).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("probes, updates files, reloads and restarts running instances", async () => {
      const dir = writeRecipePackage("named");
      tmpDirs.push(dir);
      const pm = makePackageManager({
        updateFiles: vi.fn(async () => ({ id: "temp-recipe", version: "2.0.0" })),
        getPackageDir: vi.fn(() => dir),
      });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await loader.update("temp-recipe");

      expect(pm.probePersonalUpdate).toHaveBeenCalledWith("temp-recipe", {});
      expect(pm.updateFiles).toHaveBeenCalled();
      expect(rm.registerExternal).toHaveBeenCalled();
      expect(rm.restartInstancesOfRecipe).toHaveBeenCalledWith("temp-recipe");
    });

    it("does not restart instances if the reload fails after updateFiles", async () => {
      const pm = makePackageManager({
        updateFiles: vi.fn(async () => ({ id: "ghost", version: "2.0.0" })),
        // getPackageDir → /nonexistent → reload throws, caught internally
      });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await expect(loader.update("ghost")).resolves.toBeUndefined();
      expect(rm.restartInstancesOfRecipe).not.toHaveBeenCalled();
    });
  });

  describe("loadAll", () => {
    it("skips disabled packages", async () => {
      const pm = makePackageManager({
        getInstalledByType: vi.fn(() => [{ enabled: false, manifest: { id: "off" } }]),
      });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await loader.loadAll();
      expect(rm.registerExternal).not.toHaveBeenCalled();
    });

    it("loads an enabled package present on disk", async () => {
      const dir = writeRecipePackage("named");
      tmpDirs.push(dir);
      const pm = makePackageManager({
        getInstalledByType: vi.fn(() => [{ enabled: true, manifest: { id: "temp-recipe" } }]),
        getPackageDir: vi.fn(() => dir),
      });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await loader.loadAll();
      expect(rm.registerExternal).toHaveBeenCalledOnce();
    });

    it("auto-downloads a package missing on disk when the manifest has a repo", async () => {
      const pm = makePackageManager({
        getInstalledByType: vi.fn(() => [
          { enabled: true, manifest: { id: "gone", repo: "owner/gone" } },
        ]),
        getPackageDir: vi.fn(() => "/nonexistent/gone"),
        downloadMissing: vi.fn(async () => undefined),
      });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await loader.loadAll();
      // Download attempted; load still fails (still missing) but no throw.
      expect(pm.downloadMissing).toHaveBeenCalledWith("owner/gone");
    });

    it("skips a missing package with no repo in its manifest", async () => {
      const pm = makePackageManager({
        getInstalledByType: vi.fn(() => [{ enabled: true, manifest: { id: "orphan" } }]),
        getPackageDir: vi.fn(() => "/nonexistent/orphan"),
      });
      const rm = makeRecipeManager();
      const loader = new RecipeLoader(pm, rm, logger);

      await loader.loadAll();
      expect(pm.downloadMissing).not.toHaveBeenCalled();
      expect(rm.registerExternal).not.toHaveBeenCalled();
    });
  });
});
