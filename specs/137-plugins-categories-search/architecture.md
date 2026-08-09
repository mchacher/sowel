# Architecture — Spec 137

## Flow diagram

```
plugins/registry.json (category, i18n, tags per entry)
        │
        ▼
PackageManager.getRegistryEntries()          (cached remote fetch, unchanged)
        │
        ├─► getStore() ──────────────► StoreEntry now carries category + i18n + tags
        │                                      │
        ├─► resolvePackageCategory(manifest)   │   manifest.category → registry.category → "other"
        │        ▲                             │
        │        │                             ▼
GET /api/v1/plugins (recipes branch) ──► manifest enriched with resolved category
        │                                      │
        ▼                                      ▼
                        ui/src/pages/PluginsPage.tsx
                          ├─ search input (shared, both tabs, both types)
                          ├─ recipes: grouped CategorySection list
                          └─ integrations: flat list (unchanged)
```

No new events, no WebSocket change, no DB migration, no new endpoints.

## Components

### Changed: `src/packages/registry-types.ts`

- `RECIPE_CATEGORIES = ["lighting", "climate", "water", "schedule", "safety", "energy"] as const` + `RecipeCategory` type.
- `isRecipeCategory(value: unknown): value is RecipeCategory` guard (typo-safe validation).
- `RegistryEntry.category?: string` (validated at read time, not trusted).

### Changed: `src/shared/types.ts`

- `PluginManifest.category?: string` — optional; recipes installed from personal sources (spec 136) can self-declare it in their tarball manifest.

### Changed: `src/packages/package-manager.ts`

- `getStore()` registry mapping passes through `category` (validated via `isRecipeCategory`, dropped if invalid), `i18n`, and `tags`. `StoreEntry` type extended accordingly.
- New `resolvePackageCategory(manifest: PluginManifest): RecipeCategory | "other" | undefined`:
  - returns `undefined` for non-recipes;
  - manifest `category` if valid;
  - else the registry entry's `category` (join by `id`) if valid;
  - else `"other"`.

### Changed: `src/api/routes/plugins.ts`

- `GET /api/v1/plugins`: the recipes branch spreads the resolved category into the returned manifest (`{ ...pkg.manifest, category: packageManager.resolvePackageCategory(pkg.manifest) }`). Integrations branch untouched.

### Changed: `ui/src/types.ts`

- `PluginManifest.category?: string`.
- `RECIPE_CATEGORY_ORDER` const (taxonomy order incl. `other`) — lives with the types or in a small `ui/src/lib/plugin-categories.ts` helper along with the search normalizer.

### Changed: `ui/src/pages/PluginsPage.tsx`

- New `query` state + `SearchInput` (Search icon, clear X button, `plugins.search.placeholder`).
- `matchesQuery(manifest, lang, query)`: NFD-normalized, diacritics/case-insensitive match on localized name + localized description + `tags`.
- `groupRecipes(list, lang)`: buckets by `manifest.category ?? "other"` (unknown → `other`), fixed order, alphabetical by localized name within a bucket, empty buckets dropped.
- `InstalledTab` / `StoreTab` receive the filtered lists; when the recipe type filter is active they render `CategorySection` blocks (header: localized label + count) instead of one flat `space-y-2` list.
- New "no results" empty state (`plugins.search.noResults`) distinct from `plugins.noPlugins`.

### Changed: `ui/src/i18n/locales/{en,fr}.json`

- `plugins.search.placeholder`, `plugins.search.noResults`, `plugins.category.{lighting,climate,water,schedule,safety,energy,other}`.

### Changed: `plugins/registry.json`

- `category` added to the 14 recipe entries (see taxonomy table in spec.md).

## Files changed

| Domain   | File                                   | Change                                                                    |
| -------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Packages | `src/packages/registry-types.ts`       | `RECIPE_CATEGORIES`, `isRecipeCategory`, `RegistryEntry.category`         |
| Shared   | `src/shared/types.ts`                  | `PluginManifest.category?`                                                |
| Packages | `src/packages/package-manager.ts`      | `getStore()` passthrough (category/i18n/tags), `resolvePackageCategory()` |
| Packages | `src/packages/package-manager.test.ts` | New scenarios (see plan.md test plan)                                     |
| API      | `src/api/routes/plugins.ts`            | Enrich installed recipe manifests with resolved category                  |
| Registry | `plugins/registry.json`                | Backfill `category` on 14 recipe entries                                  |
| UI       | `ui/src/types.ts`                      | `PluginManifest.category?`                                                |
| UI       | `ui/src/lib/plugin-categories.ts`      | New: category order, grouping, search normalizer                          |
| UI       | `ui/src/pages/PluginsPage.tsx`         | Search input, grouped recipe sections, no-results state                   |
| UI       | `ui/src/i18n/locales/en.json`          | New keys (search, categories)                                             |
| UI       | `ui/src/i18n/locales/fr.json`          | New keys (search, categories)                                             |

## Design notes

- **Why validate categories at read time**: the registry is remote data refreshed hourly; a typo must degrade to `other`, never break listing. `isRecipeCategory` is the single gate, used by both `getStore()` and `resolvePackageCategory()`.
- **Why enrich in the route, resolve in the manager**: the resolution logic (manifest → registry → other) is business logic and unit-testable in `package-manager.test.ts`; the route just spreads the result, consistent with the existing recipes-branch shape.
- **Why keep search client-side**: both lists are already fully loaded in the page (30 registry entries); server-side search would add an endpoint for nothing.
- **i18n passthrough is a bug fix**: registry `i18n` was authored (18 entries) but silently dropped by `getStore()`; the UI's `getLocalizedName/Description` helpers already consume it, so passing it through lights up existing code.
