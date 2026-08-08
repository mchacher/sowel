import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import type { Logger } from "../core/logger.js";
import type { PackageManager, InstallOptions } from "../packages/package-manager.js";
import type { RecipeManager } from "./engine/recipe-manager.js";
import type { RecipeDefinition } from "../shared/types.js";

type RecipeFactory = () => RecipeDefinition;

/**
 * Loads installed recipe packages and registers them with RecipeManager.
 */
export class RecipeLoader {
  private packageManager: PackageManager;
  private recipeManager: RecipeManager;
  private logger: Logger;

  constructor(packageManager: PackageManager, recipeManager: RecipeManager, logger: Logger) {
    this.packageManager = packageManager;
    this.recipeManager = recipeManager;
    this.logger = logger.child({ module: "recipe-loader" });
  }

  /**
   * Install a recipe from GitHub — download, register, and load immediately.
   */
  async install(repo: string, opts: InstallOptions = {}): Promise<void> {
    const manifest = await this.packageManager.installFromGitHub(repo, opts);
    if (manifest.type !== "recipe") {
      throw new Error(`Package "${manifest.id}" is not a recipe (type: ${manifest.type})`);
    }
    await this.loadNewlyInstalled(manifest.id);
  }

  /**
   * Load a recipe package that was just installed through PackageManager
   * directly (spec 136 personal installs). Errors are confined — the
   * package stays installed, load is retried at next boot.
   */
  async loadNewlyInstalled(recipeId: string): Promise<void> {
    try {
      await this.loadRecipe(recipeId);
      this.logger.info({ recipeId }, "Recipe installed and loaded");
    } catch (err) {
      this.logger.error({ err, recipeId }, "Recipe installed but failed to load");
    }
  }

  /**
   * Update a recipe — download new version and reload.
   */
  async update(recipeId: string, opts: InstallOptions = {}): Promise<void> {
    // Spec 136: unconfirmed personal update probes before touching files.
    await this.packageManager.probePersonalUpdate(recipeId, opts);
    const newManifest = await this.packageManager.updateFiles(recipeId, opts);
    try {
      await this.loadRecipe(recipeId);
      // Issue #349: running instances would otherwise keep executing the
      // previous version's closure while the UI already shows the update.
      const restarted = this.recipeManager.restartInstancesOfRecipe(recipeId);
      this.logger.info(
        { recipeId, version: newManifest.version, restartedInstances: restarted },
        "Recipe updated and reloaded",
      );
    } catch (err) {
      this.logger.error({ err, recipeId }, "Recipe updated but failed to reload");
    }
  }

  /**
   * Load all installed recipe packages and register with RecipeManager.
   * Must be called after PackageManager is ready, before recipeManager.init().
   */
  async loadAll(): Promise<void> {
    const packages = this.packageManager.getInstalledByType("recipe");
    let loaded = 0;

    for (const pkg of packages) {
      if (!pkg.enabled) {
        this.logger.debug({ recipeId: pkg.manifest.id }, "Recipe package disabled, skipping");
        continue;
      }

      // Auto-download if recipe directory is missing (e.g. after backup restore)
      const entryPath = resolve(
        this.packageManager.getPackageDir(pkg.manifest.id),
        "dist/index.js",
      );
      if (!existsSync(entryPath)) {
        const repo = pkg.manifest.repo;
        if (repo) {
          this.logger.warn(
            { recipeId: pkg.manifest.id, repo },
            "Recipe missing on disk, downloading",
          );
          try {
            await this.packageManager.downloadMissing(repo);
          } catch (err) {
            this.logger.error({ err, recipeId: pkg.manifest.id }, "Failed to auto-download recipe");
            continue;
          }
        } else {
          this.logger.warn(
            { recipeId: pkg.manifest.id },
            "Recipe missing on disk and no repo in manifest, skipping",
          );
          continue;
        }
      }

      try {
        await this.loadRecipe(pkg.manifest.id);
        loaded++;
      } catch (err) {
        this.logger.error({ err, recipeId: pkg.manifest.id }, "Failed to load recipe package");
      }
    }

    if (packages.length > 0) {
      this.logger.info({ loaded, total: packages.length }, "Recipe packages loaded");
    }
  }

  private async loadRecipe(recipeId: string): Promise<void> {
    const pkgDir = this.packageManager.getPackageDir(recipeId);
    const entryPath = resolve(pkgDir, "dist/index.js");

    if (!existsSync(entryPath)) {
      throw new Error(`Recipe entry point not found: ${entryPath}`);
    }

    // Cache-bust: append timestamp to force fresh import after reinstall
    const mod = (await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)) as {
      createRecipe?: RecipeFactory;
      default?: { createRecipe?: RecipeFactory };
    };

    const factory = mod.createRecipe ?? mod.default?.createRecipe;
    if (typeof factory !== "function") {
      throw new Error(`Recipe package "${recipeId}" does not export a createRecipe function`);
    }

    const definition = factory();
    this.recipeManager.registerExternal(definition);
  }
}
