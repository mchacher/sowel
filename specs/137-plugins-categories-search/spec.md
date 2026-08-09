# Spec 137 — Plugins Page: Recipe Categories and Search

Issue: [#361](https://github.com/mchacher/sowel/issues/361)

## Context

The Plugins page renders installed and store packages as flat lists (Installed / Store tabs, Integrations / Recipes type filter). With 14 recipes in the registry and growing, the flat list no longer scans: a user looking for "something to automate my lights" has to read every card. Registry entries carry free-form `tags`, but they are dropped by the store mapping and are too inconsistent to group on. There is no search field.

Design decided during issue triage:

- **Explicit `category` field** (closed enum) on registry entries and plugin manifests. Deriving categories from recipe slot `equipmentType` was rejected: slots live inside the tarball manifest, which the Store tab cannot see before install, so derivation would classify Installed and Store inconsistently.
- **Recipes only**: integrations stay a flat list. The `category` field is generic, so integrations can adopt categories later without rework.
- **Grouped sections** (visible category headers) rather than filter chips: organization is readable with zero clicks.

## Goals

1. Recipes in both Installed and Store tabs are grouped under localized category section headers.
2. A search field filters the visible list (integrations and recipes, both tabs) as you type.
3. The registry's `i18n` strings finally reach the Store tab (they are currently dropped by `getStore()`), so store rows display localized names/descriptions and search can match them.
4. All 14 recipe registry entries are backfilled with a category. No plugin release is required.

## Non-Goals

- Categorizing integrations (field stays generic; taxonomy can come later).
- Cleaning up registry `tags` (they stay free-form; they feed the search index).
- Server-side search or new API endpoints (pure shape enrichment of existing responses).
- React component tests (project convention).

## Category taxonomy

Closed enum, curated, i18n-ready. IDs are stable; labels are localized in the UI locale files (EN/FR).

| ID         | EN label              | FR label                   | Recipes                                                                |
| ---------- | --------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `lighting` | Lighting              | Eclairage                  | switch-light, motion-light, motion-light-dimmable, state-trigger-light |
| `climate`  | Heating and cooling   | Chauffage et climatisation | presence-heater, presence-thermostat, smart-cooling, freecooling       |
| `water`    | Watering and pool     | Arrosage et piscine        | auto-watering, pool-pump-schedule                                      |
| `schedule` | Scheduling            | Planification              | schedule-on-off                                                        |
| `safety`   | Safety and monitoring | Securite et surveillance   | state-watch, runtime-guard                                             |
| `energy`   | Energy and display    | Energie et affichage       | presence-display                                                       |
| `other`    | Other                 | Autres                     | fallback — never stored, only displayed                                |

Display order is the table order. `other` is a display-only fallback for recipes without a (valid) category; it is never written to the registry.

## Functional Requirements

### FR1 — `category` field on registry entries and manifests

- `RegistryEntry.category?: string` — optional, one of the enum IDs above (except `other`).
- `PluginManifest.category?: string` — optional, same enum. Lets personal-source recipes (spec 136) self-declare a category in their tarball manifest.
- Resolution order for an installed recipe: manifest `category` if valid → registry entry `category` (joined by `id`) if valid → `other`.
- Store entries take the registry `category` directly (invalid/missing → `other` at display time).
- Integrations never resolve to a category (field ignored for `type !== "recipe"`).
- An unknown/misspelled category value is treated as absent (defensive against registry typos), not an error.

### FR2 — Store entries carry `category`, `i18n`, and `tags`

`PackageManager.getStore()` maps registry entries into `StoreEntry` objects but currently drops `i18n` and `tags`. The mapping now passes through:

- `category` (new)
- `i18n` (fixes a latent gap: 18 registry entries have FR translations that never reach the UI)
- `tags` (used by search)

Personal-source store entries (synthesized, no registry data) get no category → grouped under `other`.

### FR3 — Installed recipes enriched with category

`GET /api/v1/plugins` enriches each installed recipe's manifest with the resolved category (FR1 resolution order). Integrations are untouched. No DB change: the enrichment is computed at listing time from the cached registry.

### FR4 — Grouped recipe sections in the UI

- When the Recipes type filter is active (Installed or Store tab), the list is grouped under category section headers: localized label + count.
- Sections appear in the fixed taxonomy order; empty sections are hidden (including `other`).
- Within a section, rows sort alphabetically by localized name.
- Integrations view stays a flat list (unchanged order).

### FR5 — Search field

- A search input sits above the list, below the tab rows, visible on both tabs and both type filters.
- Filters as you type; matches are case-insensitive and diacritics-insensitive ("eclairage" matches "Éclairage").
- Matches against: localized name, localized description (language currently displayed, manifest/registry `i18n` when available), and `tags`.
- While searching, recipe sections with no match are hidden; a section header stays visible if it has at least one match.
- Clear button (X) inside the input when non-empty.
- Empty result state: dedicated "no results" message (localized), distinct from the "no plugins" empty state.
- Search state is local to the page (not persisted), and is NOT reset when switching tabs (so a query can be compared across Installed/Store).

### FR6 — Registry backfill

`plugins/registry.json`: add `category` to the 14 recipe entries per the taxonomy table. No release, no SHA change (category is not part of the tarball).

## Acceptance Criteria

- [x] `RegistryEntry` and `PluginManifest` accept an optional `category`; invalid values degrade to `other` without errors.
- [x] `getStore()` passes `category`, `i18n`, and `tags` through to the API response.
- [x] Store tab displays localized recipe/integration names and descriptions when the registry has `i18n` for the current language.
- [x] Installed recipes get their category from the registry join without any recipe re-release; a personal recipe with `category` in its manifest keeps it.
- [x] Recipes render under localized category sections (fixed order, hidden when empty, alphabetical within) in both Installed and Store tabs.
- [x] Search filters integrations and recipes on both tabs, matching localized name + description + tags, diacritics-insensitive.
- [x] All 14 recipe entries in `plugins/registry.json` carry a valid category.
- [x] `npm run validate` passes (backend + UI typecheck, lint, tests).

## Edge Cases

- **Recipe not in the registry and no manifest category** (personal source): grouped under `other`.
- **Registry entry with a typo in `category`**: treated as missing → `other`; no crash, no console noise.
- **All recipes match one category**: single section renders (headers still shown — consistent, not a special case).
- **Search query with only whitespace**: treated as empty (no filtering).
- **Language without i18n strings** (e.g. registry entry has no `fr` block): falls back to default `name`/`description`, search matches the fallback strings.
- **Zero search results**: "no results" state, personal-sources section still reachable on the Store tab.
- **hasRecipes false** (no recipes anywhere): type filter row already hidden today; search still applies to the integrations list.
