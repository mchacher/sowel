# Spec 136 — Personal plugin sources

> Extends the plugin distribution model (spec 053) and its supply-chain
> security baseline (spec 089) with a third trust tier: **personal**
> sources. An admin can register their own GitHub repositories as plugin
> sources and install from them without going through the central
> registry, under a TOFU (Trust On First Use) security model.

## Goal

Let users develop and run their own plugins (recipes or integrations)
without requiring a PR against the central `plugins/registry.json` for
every publication and every version bump.

After this spec ships, the plugin ecosystem has three tiers:

| Tier          | Source of truth                      | Trust anchor                            | Install friction                               |
| ------------- | ------------------------------------ | --------------------------------------- | ---------------------------------------------- |
| **Official**  | Central registry, owner in whitelist | Registry SHA256 + maintainer review     | None                                           |
| **Community** | Central registry, third-party owner  | Registry SHA256 + registry PR review    | One-time confirmation modal                    |
| **Personal**  | User-added GitHub repo (this spec)   | The user themselves + TOFU hash pinning | Confirmation modal at install AND every update |

## Why

Today even a plugin meant for a single household must be merged into the
central registry (entry + SHA256), and **every version bump** requires a
new registry PR merged by the maintainer. This is a real bottleneck for
third-party developers and disproportionate for someone running their
own recipe on their own instance. It also blocks a natural development
loop (iterate on a plugin against a live Sowel without touching the
registry).

The community tier remains the promotion path when a personal plugin is
worth sharing.

## Requirements

### R1 — Source management (admin only)

- An admin can add a **personal source**: a public GitHub repository in
  `owner/repo` format.
- Adding a source validates: format (`^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$`),
  repo not already present in the central registry (those install from
  the store), source not already added.
- At add time, Sowel fetches the repo's latest GitHub release and warns
  (but does not refuse) if there is no release or no
  `sowel-*.tar.gz` asset yet — the developer may add the source before
  the first release.
- An admin can remove a source at any time. Removing a source does
  **not** uninstall plugins already installed from it; it only prevents
  future installs and updates from that source.
- Sources are stored in SQLite and included in backups.
- Private repositories are **out of scope** (no GitHub token support in
  this iteration).

### R2 — Store listing with three tiers

- The plugin store lists personal-source plugins alongside registry
  entries.
- Each store entry carries a `tier`: `official`, `community`, or
  `personal`.
- A personal entry is synthesized from the source's latest GitHub
  release: name derived from the repo name, version from the release
  tag, owner from the repo path. Rich metadata (real name, description,
  icon, type) only becomes available after install, from the tarball's
  `manifest.json`.
- A personal source with no published release appears in the sources
  management UI but not as an installable store entry.

### R3 — TOFU install flow

- Installing a personal plugin without prior confirmation is refused
  with a structured error carrying the computed identity of what would
  be installed: `{ owner, repo, version, sha256 }`. The SHA256 is
  computed by actually downloading the tarball.
- The UI shows a warning modal stronger than the community one: the code
  has been reviewed by no one, it runs with the server's privileges, and
  the user is trusting the repo owner entirely. The modal displays the
  version and the SHA256 fingerprint.
- The confirmed install call passes back the expected SHA256. The
  tarball is re-downloaded and **must match** that hash
  (`ChecksumMismatchError` otherwise) — this closes the window between
  what was shown and what is installed.
- On success the hash is **pinned** in the database alongside the
  installed plugin, and the plugin is marked `source = 'personal'`.
- All spec 089 tarball hardening applies identically: SHA256
  verification, tar flags, escaping-symlink refusal, manifest
  validation, `sowelVersion` compatibility check.
- A personal plugin whose `manifest.id` collides with a central registry
  entry id is **refused** (prevents shadowing an official plugin; the
  developer must rename their plugin id).

### R4 — TOFU update flow (re-confirmation)

- Update availability for personal plugins is detected from the source
  repo's latest GitHub release (cached, 1 hour TTL — same policy as the
  registry cache), never from the central registry.
- An update whose tarball hash differs from the pinned hash (any real
  update does) is refused without confirmation, returning the new
  `{ version, sha256 }` for the UI to display.
- The confirmed update call passes the expected SHA256, which is
  verified after download. On success the new hash replaces the pinned
  one.
- Registry-tier plugins are never version-checked against personal
  sources and vice versa: the `source` column on the installed plugin
  decides the update path.

### R5 — Registry path untouched (spec 089 invariants)

- Official and community installs are byte-for-byte the same flow as
  today: registry entry required, registry SHA256 required and verified,
  community confirmation modal unchanged.
- A repo that is neither in the central registry nor in the personal
  sources list still cannot be installed at all.
- `OFFICIAL_OWNERS` and the community gate are not weakened.

### R6 — Backup / restore

- `plugin_sources` rows and the `source` / `pinned_sha256` columns
  travel with the SQLite database in backups.
- After a restore, missing personal plugin files are re-downloaded and
  verified against the **pinned** hash (mirror of the registry-hash
  verification in `downloadMissing`). A mismatch refuses the download
  and logs a warning; the user can resolve by reinstalling explicitly.

### R7 — Isolation and observability

- Personal plugins run under the same spec 111 soft isolation as any
  plugin (scoped settings, event whitelist, device ownership) — which is
  soft by design; the install warning modal is the honest disclosure of
  that limit.
- Every personal-source mutation (source added/removed, install, update)
  is audit-logged with the repo and hash context, tier included.

## Out of scope

- **Private repositories / GitHub PAT** — future iteration; decided
  with the user 2026-08-08.
- **Signature (GPG/cosign)** — same position as spec 089: revisit when
  the ecosystem warrants it.
- **Multiple releases / version picking** — only the repo's latest
  release is installable, matching the registry behaviour.
- **Non-GitHub sources** (GitLab, raw URLs, local paths) — the whole
  distribution model is GitHub-based today.
- **Automatic promotion** of a personal plugin to community tier.
- **Per-source auto-update** — updates always require explicit
  confirmation by design (TOFU); there is deliberately no way to opt
  out.

## Edge cases

| Case                                                | Behaviour                                                                                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source repo deleted/renamed on GitHub               | Version check fails silently (warn log); store entry disappears; installed plugin keeps running.                                                                |
| Release without `sowel-*.tar.gz` asset              | Install/update fails with a clear error naming the expected asset pattern.                                                                                      |
| Tarball republished under the same tag (hash drift) | Install: confirmed call fails `ChecksumMismatchError`, UI re-prompts with the new hash. Update: same. Missing-file re-download: refused (pinned hash mismatch). |
| `manifest.id` collides with an installed plugin     | Refused (`already installed`), same as today.                                                                                                                   |
| `manifest.id` collides with a registry entry        | Refused with an explicit "shadows a registry plugin" error.                                                                                                     |
| `sowelVersion` requirement not met                  | Refused after download, before any file lands in `plugins/`.                                                                                                    |
| Source removed while its plugin is installed        | Plugin keeps running; update fails with "source removed"; re-adding the source restores updates.                                                                |
| GitHub API rate limit hit (60/h unauthenticated)    | Version checks degrade gracefully to cached values (warn log); installs surface the GitHub error.                                                               |
| Two sources exposing the same `manifest.id`         | First installed wins; second install refused (`already installed`).                                                                                             |

## Success criteria

- [x] Admin can add and remove a personal source from the UI; non-admin cannot (403).
- [x] Adding a repo present in the central registry is refused with a clear message.
- [x] A personal plugin (recipe **and** integration) installs end-to-end from a real GitHub repo with the TOFU modal showing version + SHA256. _(verified 2026-08-08 on a local dev instance against `mchacher/sowel-plugin-netatmo-security` v0.5.0: source added, modal fingerprint matched the real asset SHA256, install pinned the hash with source='personal', the plugin loaded from the tarball, uninstall and source removal left a clean state)_
- [x] The unconfirmed install/update API call never writes anything under `plugins/` nor in the DB.
- [x] A tampered tarball (hash ≠ expected) is refused on install, update, and missing-file re-download.
- [x] A new release on the source repo surfaces as an update badge within the cache TTL, and updating re-prompts with the new hash.
- [x] Official/community install and update flows are regression-tested unchanged.
- [x] A repo neither in registry nor in sources remains uninstallable.
- [x] Store and installed lists render the third **Personal** badge (FR + EN).
- [x] All new logic covered by unit tests; `npm run validate` passes.
