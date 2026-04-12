# Spec 066 — Registry independence from Sowel releases

## Context

Today, `plugins/registry.json` lives in the Sowel repo and is bundled in the Docker image. Adding or updating a plugin/recipe entry requires a full Sowel release (version bump + Docker build + deploy). This is disproportionate — a registry update is metadata, not code.

The PackageManager already fetches the registry remotely (spec 059: `https://raw.githubusercontent.com/mchacher/sowel/main/plugins/registry.json` with 1h cache + local fallback). So the remote registry on the `main` branch IS the source of truth at runtime. But the version-checker compares the installed plugin version against the registry version — and if the registry is updated on `main` without a Sowel release, the new registry is already visible to the running instance without any Docker update.

The missing piece: plugin manifests declare `sowelVersion: ">=0.10.0"` but the store UI doesn't enforce it. A user could install a recipe that requires features not yet in their Sowel version.

## Goals

1. Stop releasing Sowel just to update the registry — a `git push` to `main` suffices
2. Enforce `sowelVersion` compatibility check in the store UI and install API
3. Document the workflow: "release a plugin → update registry on main → done"

## Non-Goals

- Moving the registry to a separate repo (overkill — raw GitHub fetch from `main` already works)
- Auto-discovery of plugins without a registry (registry is the curated list)
- Plugin signing or verification

## Functional Requirements

### FR1 — sowelVersion enforcement in store

When listing available packages in the store (`GET /api/v1/plugins/store`):

- Read the current Sowel version from `package.json`
- For each registry entry, check `sowelVersion` constraint (semver range)
- If incompatible: still show in the list but mark as `compatible: false` with a reason
- The UI disables the "Install" button for incompatible packages and shows "Requires Sowel >= X.Y.Z"

### FR2 — sowelVersion enforcement on install

When installing via `POST /api/v1/plugins/install`:

- Read the manifest's `sowelVersion` after download
- If the current Sowel version doesn't satisfy the constraint → reject with error "This package requires Sowel >= X.Y.Z (current: A.B.C)"
- The install is aborted and the downloaded files are cleaned up

### FR3 — sowelVersion in manifest best practice

All plugin/recipe manifests MUST declare `sowelVersion` with a meaningful constraint:

- `">=1.1.0"` — requires features from v1.1.0+
- `">=0.10.0"` — compatible with most versions (legacy default)

The registry entry MAY also include `sowelVersion` for the store UI to check before download.

### FR4 — Registry update workflow documentation

Document in `docs/technical/plugin-development.md`:

1. Release the plugin on GitHub (tag + GitHub Actions release)
2. Update `plugins/registry.json` on the Sowel `main` branch (bump version, add entry)
3. Push to `main` — no Sowel release needed
4. Running Sowel instances pick up the change within 1h (registry cache TTL)
5. Users see the update in Settings → Store

No Docker rebuild, no version bump, no deploy.

## Acceptance Criteria

- [ ] FR1: Store API returns `compatible` field for each package based on sowelVersion check
- [ ] FR1: Store UI disables install for incompatible packages with clear message
- [ ] FR2: Install API rejects packages with incompatible sowelVersion
- [ ] FR3: All existing plugin/recipe manifests have meaningful sowelVersion constraints
- [ ] FR4: Plugin development docs updated with the registry workflow
- [ ] Existing install/update flows unaffected for compatible packages

## Edge Cases

- **sowelVersion missing from manifest**: treat as compatible (backwards compat with old plugins)
- **Invalid semver in sowelVersion**: treat as compatible, log warning
- **Registry entry has sowelVersion but downloaded manifest doesn't**: use registry value
- **User on old Sowel version**: sees new plugins in store but can't install them — clear messaging

## Related

- Spec 059 — Remote registry fetch with cache + local fallback
- Spec 053 — PackageManager architecture
- Current workflow pain: specs 063/065 required unnecessary Sowel releases just for registry updates
