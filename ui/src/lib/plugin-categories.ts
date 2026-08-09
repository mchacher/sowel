import type { PluginManifest } from "../types";

/**
 * Recipe category display order (spec 137). Mirrors RECIPE_CATEGORIES in
 * src/packages/registry-types.ts, plus the "other" display-only fallback.
 * Labels live in the locale files under `plugins.category.<id>`.
 */
export const RECIPE_CATEGORY_ORDER = [
  "lighting",
  "climate",
  "water",
  "schedule",
  "safety",
  "energy",
  "other",
] as const;

export type RecipeCategoryId = (typeof RECIPE_CATEGORY_ORDER)[number];

/** Bucket a manifest into a known category, defaulting unknowns to "other". */
export function categoryOf(manifest: PluginManifest): RecipeCategoryId {
  const cat = manifest.category;
  return cat && (RECIPE_CATEGORY_ORDER as readonly string[]).includes(cat) && cat !== "other"
    ? (cat as RecipeCategoryId)
    : "other";
}

/** Localized manifest name with fallback (same rule as the page helpers). */
export function localizedName(manifest: PluginManifest, lang: string): string {
  return manifest.i18n?.[lang]?.name ?? manifest.name;
}

/** Localized manifest description with fallback. */
export function localizedDescription(manifest: PluginManifest, lang: string): string {
  return manifest.i18n?.[lang]?.description ?? manifest.description;
}

/** Lowercase and strip diacritics so "eclairage" matches "Éclairage". */
export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * True when the manifest matches the search query (spec 137).
 * Matches the localized name and description plus the free-form tags,
 * case- and diacritics-insensitive. A blank query matches everything.
 */
export function matchesQuery(manifest: PluginManifest, lang: string, query: string): boolean {
  const q = normalizeForSearch(query.trim());
  if (!q) return true;
  const haystack = [
    localizedName(manifest, lang),
    localizedDescription(manifest, lang),
    ...(manifest.tags ?? []),
  ];
  return haystack.some((s) => normalizeForSearch(s).includes(q));
}

/**
 * Group recipe manifests into ordered category buckets (spec 137).
 * Buckets follow RECIPE_CATEGORY_ORDER, empty buckets are dropped, and
 * items sort alphabetically by localized name within each bucket.
 */
export function groupByCategory<T>(
  items: T[],
  getManifest: (item: T) => PluginManifest,
  lang: string,
): Array<{ category: RecipeCategoryId; items: T[] }> {
  const buckets = new Map<RecipeCategoryId, T[]>();
  for (const item of items) {
    const cat = categoryOf(getManifest(item));
    const bucket = buckets.get(cat);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(cat, [item]);
    }
  }
  return RECIPE_CATEGORY_ORDER.filter((cat) => buckets.has(cat)).map((cat) => ({
    category: cat,
    items: buckets
      .get(cat)!
      .slice()
      .sort((a, b) =>
        localizedName(getManifest(a), lang).localeCompare(
          localizedName(getManifest(b), lang),
          lang,
        ),
      ),
  }));
}
