import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import type { Logger } from "../core/logger.js";
import type { PackageManager } from "../packages/package-manager.js";
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
