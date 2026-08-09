# Implementation Plan — Spec 137

## Slices

### Slice A — Backend: category plumbing

- [x] A.1 — `registry-types.ts`: `RECIPE_CATEGORIES`, `RecipeCategory`, `isRecipeCategory()`, `RegistryEntry.category?`
- [x] A.2 — `src/shared/types.ts`: `PluginManifest.category?`
- [x] A.3 — `package-manager.ts`: `getStore()` passes through `category` (validated), `i18n`, `tags`; extend `StoreEntry`
- [x] A.4 — `package-manager.ts`: `resolvePackageCategory(manifest)`
- [x] A.5 — `src/api/routes/plugins.ts`: enrich installed recipe manifests with resolved category

### Slice B — Tests (backend)

- [x] B.1 — `package-manager.test.ts`: scenarios from the test plan below

### Slice C — Registry backfill

- [x] C.1 — `plugins/registry.json`: add `category` to the 14 recipe entries (taxonomy in spec.md)

### Slice D — UI

- [x] D.1 — `ui/src/types.ts`: `PluginManifest.category?`
- [x] D.2 — `ui/src/lib/plugin-categories.ts`: category order, `groupByCategory()`, `normalizeForSearch()`, `matchesQuery()`
- [x] D.3 — `PluginsPage.tsx`: search input + shared filtering (both tabs, both types)
- [x] D.4 — `PluginsPage.tsx`: grouped `CategorySection` rendering for recipes (Installed + Store)
- [x] D.5 — `PluginsPage.tsx`: "no results" empty state
- [x] D.6 — `ui/src/i18n/locales/{en,fr}.json`: new keys

### Slice E — Validation & docs

- [x] E.1 — `npm run validate` (backend + UI typecheck, lint, tests) — all green
- [x] E.2 — Verified against the local dev instance via API: store entries carry i18n + tags, installed recipes resolve to "other" while the remote registry has no categories yet (expected until merge)
- [x] E.3 — Update `docs/user/plugins.md` (+ FR) for search + categories
- [x] E.4 — Mark acceptance criteria in spec.md, tasks here

## Test Plan

### Modules to test

- `src/packages/package-manager.ts` — store mapping passthrough + category resolution (all new business logic lives here; the route change is a one-line spread, the UI is untested by convention)

### Scenarios per module

| Module          | Scenario                                                                           | Expected                                                |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| package-manager | getStore(): registry recipe entry with valid `category`                            | StoreEntry carries the category                         |
| package-manager | getStore(): registry entry with invalid `category` value                           | StoreEntry has no category (undefined)                  |
| package-manager | getStore(): registry entry with `i18n` and `tags`                                  | Both passed through unchanged                           |
| package-manager | getStore(): personal-source store entry                                            | No category (undefined)                                 |
| package-manager | resolvePackageCategory: integration manifest                                       | undefined                                               |
| package-manager | resolvePackageCategory: recipe manifest with valid own `category`                  | Manifest category wins over registry                    |
| package-manager | resolvePackageCategory: recipe manifest without category, registry has one         | Registry category returned                              |
| package-manager | resolvePackageCategory: recipe manifest with invalid category, registry valid      | Falls through to registry category                      |
| package-manager | resolvePackageCategory: recipe absent from registry, no manifest category          | "other"                                                 |
| package-manager | resolvePackageCategory: registry entry with invalid category, no manifest category | "other"                                                 |
| registry data   | every recipe entry in `plugins/registry.json` has a valid category                 | Guard test: future recipe additions must be categorized |

### Retro-compat

- getStore() keeps every existing field (id, name, version, description, icon, author, repo, type, sowelVersion, compatible, isOfficial, tier, compatReason) — covered implicitly by existing tests in `package-manager.test.ts` which must keep passing.
- `GET /api/v1/plugins` response shape only gains an optional manifest field — no consumer breaks.

## Validation Plan

- `npx tsc --noEmit`, `cd ui && npx tsc -b --noEmit`
- `npx eslint src/ --ext .ts`, `cd ui && npx eslint .`
- `npx vitest run`
- Manual: dev instance, FR and EN, Installed + Store tabs, search with diacritics, empty-result state, personal-source recipe falls into "Other"
