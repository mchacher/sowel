# Spec 136 — Implementation plan

Branch: `feat/personal-plugin-sources`

## Tasks

Ordered per the standard implementation order (types → DB → core →
logic → tests → API → UI).

### 1. Types & DB

- [x] `src/shared/types.ts`: `PackageTier`, `PackageSource`,
      `PluginSource`; add `source` to `InstalledPackage` and
      `PluginInfo`; add `tier` to the store entry shape.
- [x] `migrations/015_plugin_sources.sql`: `plugin_sources` table +
      `plugins.source` + `plugins.pinned_sha256`.

### 2. Packages core

- [x] `src/packages/registry-types.ts`:
      `PersonalPluginConfirmationRequiredError`.
- [x] `src/packages/personal-sources.ts`: `PersonalSourceManager`
      (list/add/remove/has, release lookup + 1 h cache + forced refresh,
      store entry synthesis).
- [x] `src/packages/package-manager.ts`:
  - [x] `downloadPrebuiltAsset` takes `expectedSha256` (registry callers
        pass `entry.sha256`).
  - [x] `downloadAndHash` helper (no extraction).
  - [x] Personal branch in `installFromGitHub` (TOFU, id shadowing
        check, `sowelVersion` check, pin hash, `source='personal'`).
  - [x] Personal branch in `updateFiles(packageId, opts)` (re-confirm +
        re-pin, "source removed" refusal).
  - [x] Personal branch in `downloadMissing` (verify pinned hash).
  - [x] `getStore()` merges personal entries + `tier` on all entries.
- [x] `src/plugins/plugin-loader.ts` + `src/recipes/recipe-loader.ts`:
      pass-through options, extract `loadNewlyInstalled(manifest)`,
      personal `latestVersion` enrichment (plugin side).

### 3. Tests (see test plan below)

- [x] `src/packages/personal-sources.test.ts` (new)
- [x] `src/packages/package-manager.test.ts` (extend)

### 4. API

- [x] `src/api/routes/plugins.ts`: sources routes (GET/POST/remove),
      personal 409 on install and update, post-install type dispatch,
      personal `latestVersion` for recipe rows, audit logs, extend
      `store/refresh`.

### 5. UI

- [x] `ui/src/api.ts`: error class, sources calls, `expectedSha256`.
- [x] `ui/src/pages/PluginsPage.tsx`: sources section, personal badge
      (store + installed), personal confirm modal (install + update
      paths).
- [x] `ui/src/i18n/locales/en.json` + `fr.json`: `plugins.sources.*`,
      `plugins.personal.*`.

### 6. Docs (via `/update-docs` at the end)

- [x] `docs/technical/architecture.md` (three tiers),
      `docs/technical/plugin-development.md` (personal source dev
      workflow), `docs/technical/api-reference.md` (endpoints).

## Test plan

Framework: Vitest, colocated `*.test.ts`. GitHub API and tarball
downloads are mocked following the existing patterns in
`package-manager.test.ts` (fetch mock + fixture tarballs built on the
fly). No UI tests (project convention).

### Modules to test

- `personal-sources.ts` — source CRUD + release cache
- `package-manager.ts` — personal install / update / downloadMissing /
  store merge, registry regression

### Scenarios per module

| Module           | Scenario                                                               | Expected                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| personal-sources | Add valid `owner/repo`                                                 | Row inserted, returned with `latestVersion` when a release exists                                                                       |
| personal-sources | Add with bad format (`no-slash`, URL, `..`)                            | Throws validation error, no row                                                                                                         |
| personal-sources | Add duplicate                                                          | Throws, single row remains                                                                                                              |
| personal-sources | Add repo present in registry (checked at route/PM level)               | Refused with explicit message                                                                                                           |
| personal-sources | Remove existing source                                                 | Row gone; `has()` false                                                                                                                 |
| personal-sources | Release lookup: no release / no `sowel-*.tar.gz` asset / API error     | `undefined` + warn, no throw; cached value served when present                                                                          |
| personal-sources | Release cache TTL                                                      | Second call within TTL does not re-fetch (fetch mock call count)                                                                        |
| package-manager  | Personal install, `!confirmed`                                         | Throws `PersonalPluginConfirmationRequiredError` with version + sha256; tmp cleaned; no DB row, nothing in `plugins/`                   |
| package-manager  | Personal install, confirmed + matching `expectedSha256`                | Installed; row has `source='personal'`, `pinned_sha256` set                                                                             |
| package-manager  | Personal install, confirmed but tarball drifted (hash ≠ expected)      | Throws `ChecksumMismatchError`; nothing installed                                                                                       |
| package-manager  | Personal install, confirmed without `expectedSha256`                   | Refused (error), nothing installed                                                                                                      |
| package-manager  | Personal install, `manifest.id` shadows a registry entry id            | Refused with shadowing error                                                                                                            |
| package-manager  | Personal install, `sowelVersion` incompatible                          | Refused after download, nothing installed                                                                                               |
| package-manager  | Personal install, tarball with escaping symlink                        | `SymlinkInTarballError` (hardening shared with registry path)                                                                           |
| package-manager  | Install repo neither in registry nor in sources (regression, spec 089) | Throws "not found in registry"                                                                                                          |
| package-manager  | Official install (regression)                                          | Unchanged: no confirmation, registry sha256 verified                                                                                    |
| package-manager  | Community install without `confirmed` (regression)                     | `CommunityPluginConfirmationRequiredError` unchanged                                                                                    |
| package-manager  | Personal update, new release, `!confirmed`                             | `PersonalPluginConfirmationRequiredError` with new hash; files untouched                                                                |
| package-manager  | Personal update, confirmed + matching hash                             | Updated; `pinned_sha256` re-pinned to new hash                                                                                          |
| package-manager  | Personal update after source removed                                   | Refused "source removed"; files untouched                                                                                               |
| package-manager  | Registry update (regression)                                           | Unchanged flow, no confirmation                                                                                                         |
| package-manager  | `downloadMissing` personal, tarball matches pinned hash                | Files restored                                                                                                                          |
| package-manager  | `downloadMissing` personal, hash mismatch                              | Refused, warn logged, no files written                                                                                                  |
| package-manager  | `getStore()` merge                                                     | Personal entries present with `tier='personal'`; registry entries carry `official`/`community` tiers; installed personal repos excluded |

Route-level behaviour (409 shape, admin gating, audit logs) follows the
existing pattern of manual verification via the UI — consistent with how
spec 089's route layer was validated. If a route test harness pattern
exists by then, add install-409 coverage there too.

### Manual verification (before PR)

- Add a real public repo (e.g. a fork of `sowel-recipe-state-watch`)
  as a source on the dev instance; install it via the modal; check
  badge, hash display, audit log.
- Publish a new release on the fork; verify the update badge appears
  after cache refresh and the update re-prompts with the new hash.
- Remove the source; verify the plugin keeps running and update is
  refused.
- Regression: install one official plugin and confirm no behaviour
  change.

## Estimated effort

| Chunk                           | Effort        |
| ------------------------------- | ------------- |
| Types + migration               | XS            |
| PersonalSourceManager + tests   | S             |
| PackageManager branches + tests | M             |
| Loaders + routes                | S             |
| UI (sources, badges, modals)    | M             |
| i18n + docs                     | S             |
| **Total**                       | **~2-3 days** |
