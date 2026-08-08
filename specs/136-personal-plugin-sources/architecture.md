# Spec 136 — Architecture

## Overview

The central registry path (spec 089) is left intact. A parallel
"personal source" path is added inside `PackageManager`, with its own
resolution, trust, and update logic. The branch point is a single
question asked once per operation: _is this repo in the central registry
(registry path) or in the `plugin_sources` table (personal path)?_
Registry wins if a repo were somehow in both — but the add-source API
refuses registry repos, so the overlap cannot be created through the
API.

```
POST /plugins/install {repo, confirmed?, expectedSha256?}
  └─ PackageManager.installFromGitHub(repo, opts)
       ├─ repo in registry  → existing spec 089 flow (unchanged)
       │    official  → install
       │    community → confirmed? → install
       └─ repo in plugin_sources → personal flow (new)
            !confirmed          → download+hash → throw PersonalPluginConfirmationRequired{version, sha256}
            confirmed+expected  → download → hash must equal expectedSha256
                                → manifest checks (id shadowing, sowelVersion)
                                → install, plugins.source='personal', plugins.pinned_sha256=hash
```

## Data model

### Migration `015_plugin_sources.sql`

```sql
CREATE TABLE plugin_sources (
  repo TEXT PRIMARY KEY,          -- "owner/repo"
  added_at TEXT NOT NULL          -- ISO 8601
);

ALTER TABLE plugins ADD COLUMN source TEXT NOT NULL DEFAULT 'registry';  -- 'registry' | 'personal'
ALTER TABLE plugins ADD COLUMN pinned_sha256 TEXT;                       -- personal plugins only
```

Existing rows get `source='registry'` via the column default — correct
by construction, since nothing else could have installed them.

### Types (`src/shared/types.ts`)

```ts
export type PackageTier = "official" | "community" | "personal";
export type PackageSource = "registry" | "personal";

export interface PluginSource {
  repo: string; // "owner/repo"
  addedAt: string;
  latestVersion?: string; // from GitHub releases, undefined if none/unreachable
}

// InstalledPackage gains:
//   source: PackageSource;
// Store entries (getStore return) gain:
//   tier: PackageTier;            // replaces UI-side isOfficial-only logic (isOfficial kept for compat)
// PluginInfo gains:
//   source: PackageSource;
```

### Errors (`src/packages/registry-types.ts`)

```ts
export class PersonalPluginConfirmationRequiredError extends Error {
  constructor(
    public readonly repo: string,
    public readonly owner: string,
    public readonly version: string,
    public readonly sha256: string,
  ) { ... }
}
```

`ChecksumMismatchError`, `SymlinkInTarballError` are reused as-is.

## Backend components

### New: `src/packages/personal-sources.ts` — `PersonalSourceManager`

Owns the `plugin_sources` table and the GitHub release lookups for
personal repos. Constructed by `PackageManager` (db + logger), exposed
as `packageManager.sources`.

| Method                          | Role                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list(): PluginSource[]`        | All sources, enriched with cached `latestVersion`.                                                                                                                                                                       |
| `add(repo): PluginSource`       | Validate format, refuse registry repos (checked by caller passing registry repos set), refuse duplicates, insert. Returns the source with a best-effort release probe (`latestVersion` or warning).                      |
| `remove(repo): void`            | Delete row. No cascade on installed plugins.                                                                                                                                                                             |
| `has(repo): boolean`            | Membership test used by the install branch point.                                                                                                                                                                        |
| `getLatestRelease(repo)`        | `{version, assetUrl, assetName}` from `GET /repos/{repo}/releases/latest`, cached 1 h per repo (in-memory `Map`, same TTL policy as the registry cache). Errors → `undefined` + warn log, stale cache served if present. |
| `getStoreEntries(installedIds)` | Synthesized store entries for sources with a release and no installed plugin from that repo, `tier: "personal"`.                                                                                                         |

Release cache notes: passive reads serve the cache and refresh in the
background (mirror of `getRegistryEntries()`); the store "Refresh"
button forces a refetch of all sources. With unauthenticated GitHub API
at 60 req/h, N sources cost N calls per TTL window — fine for the
expected handful; failures degrade to cache with a warn log.

### Modified: `src/packages/package-manager.ts`

- `downloadPrebuiltAsset(repo, tmpDir, expectedSha256, pluginIdForLog)` —
  signature change: takes the expected hash directly instead of a
  `RegistryEntry`. Registry callers pass `entry.sha256`; personal
  callers pass the user-confirmed or pinned hash. Hardening (tar flags,
  symlink scan) unchanged.
- New private `downloadAndHash(repo, tmpDir)` — downloads the latest
  release tarball, returns `{tarballPath, version, sha256}` without
  extracting. Used by the unconfirmed personal install/update calls to
  compute the identity shown in the modal. The tmp file is discarded
  afterwards; the confirmed call re-downloads and verifies, closing the
  TOCTOU window.
- `installFromGitHub(repo, opts)` — after the registry lookup miss, if
  `sources.has(repo)`: run the personal flow (above). New manifest
  checks in the personal flow only: `manifest.id` must not match any
  registry entry id (`RegistryEntryShadowedError`-style plain `Error`),
  `isCompatible(manifest.sowelVersion)` must hold. On success, insert
  with `source='personal'`, `pinned_sha256`.
- `InstallOptions` gains `expectedSha256?: string`.
- `updateFiles(packageId, opts?)` — branch on the row's `source`:
  - `registry`: unchanged flow.
  - `personal`: resolve repo from manifest, `getLatestRelease`,
    download+hash; if `!opts.confirmed` → throw
    `PersonalPluginConfirmationRequiredError` with the new hash; else
    verify against `opts.expectedSha256`, extract, update row and
    `pinned_sha256`. Refuse with "source removed" if the repo is no
    longer in `plugin_sources`.
- `downloadMissing(repo)` — registry lookup miss + installed row with
  `source='personal'` → verify against `pinned_sha256` instead of a
  registry hash.
- `getStore()` — merge `sources.getStoreEntries(...)`; every entry now
  carries `tier` (`official`/`community` from `isOfficial`, `personal`
  for source entries). `isOfficial` boolean kept for UI compat.
- `getLatestVersions()` — unchanged (registry only). Personal latest
  versions are resolved per-plugin via `sources.getLatestRelease` in the
  enrichment paths (see routes), keyed by the manifest repo, and only
  for rows with `source='personal'`.

### Modified: loaders and routes

- `PluginLoader.getInstalled()` / the recipe branch of
  `GET /api/v1/plugins` — for `source='personal'` rows, `latestVersion`
  comes from `sources.getLatestRelease(manifest.repo)` (cached), not the
  registry map.
- `PluginLoader.install` / `RecipeLoader.install` — pass-through of the
  extended `InstallOptions` (no logic change).
- `POST /api/v1/plugins/install` (`src/api/routes/plugins.ts`) — the
  route currently picks recipe-vs-integration loader from the registry
  entry's `type`. For personal repos the type is unknown pre-download,
  so the route branches: registry repo → current code; personal repo →
  `packageManager.installFromGitHub` first, then dispatch to
  `recipeLoader`/`pluginLoader` post-install by `manifest.type` (both
  loaders expose their load-after-install step; minor refactor:
  `PluginLoader.loadNewlyInstalled(manifest)` and
  `RecipeLoader.loadNewlyInstalled(manifest)` extracted from the tail of
  their `install()`).
  New catch: `PersonalPluginConfirmationRequiredError` → **409**
  `{ error: "PersonalPluginConfirmationRequired", repo, owner, version, sha256 }`
  (same shape family as the community 409).
- `POST /api/v1/plugins/:id/update` — same 409 mapping; body gains
  optional `{ confirmed, expectedSha256 }`.
- New routes (all admin-gated like the rest of the file, audit-logged):
  - `GET  /api/v1/plugins/sources` → `PluginSource[]`
  - `POST /api/v1/plugins/sources` `{repo}` → 201 `PluginSource` or 400
    (format / registry overlap / duplicate)
  - `POST /api/v1/plugins/sources/remove` `{repo}` → 204
    (`POST .../remove` rather than `DELETE` with a body — repo contains
    `/`, and DELETE bodies are unreliable through proxies)
  - `POST /api/v1/plugins/store/refresh` — additionally force-refreshes
    the personal release cache.

## Event flow

No new EventBus event types. Store/installed lists are pull-based today
(the UI reloads after each mutation) and personal sources follow the
same pattern. The existing `usePluginUpdates` badge counter keeps
working because it derives from `latestVersion` on `GET /api/v1/plugins`.

## UI (`ui/src/pages/PluginsPage.tsx`, `ui/src/api.ts`)

- `api.ts`: `PersonalPluginConfirmationRequiredError` class (409
  discriminated on `error` field), `getPluginSources` /
  `addPluginSource` / `removePluginSource`, `installPlugin` and
  `updatePlugin` gain `expectedSha256?`.
- Store tab:
  - **"My sources" section** (admin): list of sources with repo,
    latest version or "no release yet", remove button; an add form with
    a single `owner/repo` input. Kept inside PluginsPage as internal
    components, consistent with the existing file layout.
  - Personal store rows: **violet "Personal" badge** (visually distinct
    from the amber community badge), `owner/repo` shown as author.
  - **Personal confirm modal**: reuses the community modal skeleton with
    a stronger body (unreviewed code, full server privileges), plus
    monospace version + SHA256 fingerprint (first 12 chars, full hash in
    a tooltip/title). Confirm re-calls install with
    `{confirmed: true, expectedSha256}`.
- Installed tab: personal badge on rows with `source='personal'`; the
  Update button handles the new 409 by opening the same modal with the
  new hash, then retries with `expectedSha256`.
- i18n: new keys under `plugins.sources.*` and `plugins.personal.*` in
  `en.json` + `fr.json` (badge, modal title/body/confirm, sources
  section labels, errors). No em/en dashes in copy.

## Security notes

- The unconfirmed call downloads to tmp only, computes the hash, deletes
  the file, and throws — nothing is extracted, nothing lands in
  `plugins/` or the DB. Extraction only ever happens on the confirmed
  path after the hash equality check.
- The confirmed call's `expectedSha256` is required for the personal
  path (400 if absent) so "confirmed" can never silently accept a
  drifted tarball.
- The registry gate of spec 089 is not touched: the personal branch is
  reachable only for repos an admin explicitly added, and
  `plugin_sources` writes are admin-only + audit-logged.
- Id shadowing check prevents a personal plugin from claiming an
  official id and hijacking its future updates.

## File change summary

| File                                     | Change                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `migrations/015_plugin_sources.sql`      | New table + 2 columns on `plugins`.                                                                         |
| `src/shared/types.ts`                    | `PackageTier`, `PackageSource`, `PluginSource`, field additions.                                            |
| `src/packages/registry-types.ts`         | `PersonalPluginConfirmationRequiredError`.                                                                  |
| `src/packages/personal-sources.ts` (new) | `PersonalSourceManager` (table CRUD, release cache, store synthesis).                                       |
| `src/packages/package-manager.ts`        | Branch point, personal install/update/downloadMissing, `expectedSha256`, store merge.                       |
| `src/plugins/plugin-loader.ts`           | Options pass-through, `loadNewlyInstalled` extraction, personal `latestVersion`.                            |
| `src/recipes/recipe-loader.ts`           | Options pass-through, `loadNewlyInstalled` extraction.                                                      |
| `src/api/routes/plugins.ts`              | Sources routes, personal 409 mapping, post-install type dispatch, recipe `latestVersion` for personal rows. |
| `ui/src/api.ts`                          | Sources API, error class, `expectedSha256` params.                                                          |
| `ui/src/pages/PluginsPage.tsx`           | Sources section, personal badge, personal confirm modal (install + update).                                 |
| `ui/src/i18n/locales/{en,fr}.json`       | New keys.                                                                                                   |
| `docs/technical/architecture.md`         | Three-tier distribution model section.                                                                      |
| `docs/technical/plugin-development.md`   | "Develop with a personal source" workflow.                                                                  |
| `docs/technical/api-reference.md`        | New endpoints.                                                                                              |
