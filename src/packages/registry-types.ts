/**
 * Plugin registry types and security constants (spec 089).
 *
 * The registry is fetched from
 * https://raw.githubusercontent.com/mchacher/sowel/main/plugins/registry.json
 * (with a bundled local fallback). Each entry carries the asset SHA256
 * which is verified at install time, and an owner that drives the
 * official-vs-community UI distinction.
 */

/** Owners considered "official" — no UI friction at install time. */
export const OFFICIAL_OWNERS = ["mchacher"] as const;

/**
 * Curated recipe categories (spec 137). Closed enum: registry entries and
 * manifests may declare one of these; anything else is treated as absent
 * and the recipe is displayed under the "other" fallback bucket.
 */
export const RECIPE_CATEGORIES = [
  "lighting",
  "climate",
  "water",
  "schedule",
  "safety",
  "energy",
] as const;

export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number];

/** Type guard validating a registry/manifest category value. */
export function isRecipeCategory(value: unknown): value is RecipeCategory {
  return typeof value === "string" && (RECIPE_CATEGORIES as readonly string[]).includes(value);
}

/** Schema of a single entry in `plugins/registry.json`. */
export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Display author name. Free-form, shown in UI. */
  author: string;
  /** GitHub `owner/repo`. */
  repo: string;
  /** GitHub login that owns the repo. Used for official-vs-community check.
   * Derived from `repo` if missing. */
  owner?: string;
  /** SHA256 of the release asset tarball. Required (spec 089). 64 hex chars. */
  sha256?: string;
  version?: string;
  type?: string;
  /** Curated recipe category (spec 137). Validated with isRecipeCategory at read time. */
  category?: string;
  tags: string[];
  i18n?: Record<string, { name?: string; description?: string }>;
  sowelVersion?: string;
}

/** Returns true if the registry entry's owner is in OFFICIAL_OWNERS. */
export function isOfficial(entry: RegistryEntry): boolean {
  const owner = entry.owner ?? entry.repo.split("/")[0] ?? "";
  return (OFFICIAL_OWNERS as readonly string[]).includes(owner);
}

/** Thrown when the downloaded tarball SHA256 does not match the registry. */
export class ChecksumMismatchError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `Plugin ${pluginId}: SHA256 mismatch (expected ${expected.slice(0, 8)}…, got ${actual.slice(0, 8)}…)`,
    );
    this.name = "ChecksumMismatchError";
  }
}

/** Thrown when the registry entry is missing required security fields. */
export class RegistryEntryInvalidError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly missingField: "sha256" | "owner" | "repo",
  ) {
    super(`Registry entry ${pluginId} is missing required field '${missingField}'`);
    this.name = "RegistryEntryInvalidError";
  }
}

/**
 * Thrown when a personal-source plugin install or update needs the TOFU
 * confirmation step (spec 136). Carries the identity of what would be
 * installed so the UI can display version + SHA256 fingerprint.
 */
export class PersonalPluginConfirmationRequiredError extends Error {
  constructor(
    public readonly repo: string,
    public readonly owner: string,
    public readonly version: string,
    public readonly sha256: string,
  ) {
    super(
      `Plugin from personal source ${repo} (v${version}, sha256 ${sha256.slice(0, 12)}…) requires explicit confirmation.`,
    );
    this.name = "PersonalPluginConfirmationRequiredError";
  }
}

/** Thrown when a community plugin install is attempted without explicit user confirmation. */
export class CommunityPluginConfirmationRequiredError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly owner: string,
  ) {
    super(
      `Plugin ${pluginId} (owner '${owner}') is a community plugin; explicit confirmation required.`,
    );
    this.name = "CommunityPluginConfirmationRequiredError";
  }
}

/** Thrown when a tarball contains a symlink whose target escapes the extract dir. */
export class SymlinkInTarballError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly symlinkPath: string,
  ) {
    super(
      `Plugin ${pluginId}: tarball contains an escaping symlink (${symlinkPath}); refused for security.`,
    );
    this.name = "SymlinkInTarballError";
  }
}
