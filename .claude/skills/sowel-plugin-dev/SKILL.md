---
name: sowel-plugin-dev
description: |
  Create a new plugin integration for Sowel — covers plugin code, new equipment types, UI bindings, zone cards, dashboard widgets, and all required touchpoints. Use when creating a new plugin, adding a new device source, or adding new equipment types.
disable-model-invocation: true
argument-hint: "[plugin-name]"
---

# Sowel Plugin Integration Workflow

Plugin to create: $ARGUMENTS

Follow EVERY phase below IN ORDER. Each phase has a GATE. Do NOT skip gates.

All conventions are in `CLAUDE.md`. For the full UI touchpoint checklist, see [reference.md](reference.md).

---

## Phase 1: Understand & Clarify

### 1.1 Read Essential Documentation

| Document                                   | Purpose                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| `CLAUDE.md`                                | Project conventions and rules (entry point)          |
| `docs/technical/plugin-development.md`     | Full plugin development guide (end-to-end)           |
| `docs/technical/architecture.md`           | Plugin architecture V2 section                       |
| `src/shared/types.ts`                      | EquipmentType union, IntegrationPlugin, etc          |
| `src/shared/plugin-api.ts`                 | PluginDeps interface, PluginFactory type             |
| `src/packages/package-manager.ts`          | Package lifecycle (install from GitHub, update, etc) |
| `src/plugins/plugin-loader.ts`             | Integration plugin loader (factory + registration)   |
| `src/integrations/integration-registry.ts` | IntegrationPlugin interface                          |

Also study an existing plugin repo for reference:

- [`sowel-plugin-weather-forecast`](https://github.com/mchacher/sowel-plugin-weather-forecast) — simple polling plugin (read-only)
- [`sowel-plugin-smartthings`](https://github.com/mchacher/sowel-plugin-smartthings) — polling + orders (read/write) with OAuth
- [`sowel-plugin-zigbee2mqtt`](https://github.com/mchacher/sowel-plugin-zigbee2mqtt) — MQTT-based discovery

**Plugins live in separate GitHub repos** — they are NOT in the main Sowel repo.

### 1.2 Deep-Dive Requirements

**Do not assume. Ask clarifying questions.**

| Topic               | Questions to ask                                                   |
| ------------------- | ------------------------------------------------------------------ |
| **API**             | What external API? Auth method (token, OAuth, local)? Rate limits? |
| **Devices**         | What device types will be discovered? What data does each expose?  |
| **Equipment types** | Do existing types fit, or do we need new ones?                     |
| **Orders**          | What commands can be sent? What's the API contract?                |
| **Polling**         | What interval? What data changes frequently vs. rarely?            |
| **Energy**          | Does the device expose energy data? Cumulative or delta?           |
| **Edge cases**      | API down? Device offline? Token expired? Rate limited?             |
| **Testing**         | Does the user have real devices? API credentials?                  |

### 1.3 Test the API First

Before writing a spec, test the external API with a script to confirm scope.

> **GATE 1**: Requirements are crystal clear. You can describe every device type, data point, and order.

---

## Phase 2: Document the Spec

### 2.1 Create Spec

```bash
ls specs/ | tail -1
mkdir specs/XXX-plugin-<name>
```

Write `spec.md` with: Summary, Acceptance Criteria, Scope (In/Out), Edge Cases.

### 2.2 Present Summary

```
## Résumé

**Plugin**: [Name]
**Devices**: [What will be discovered]
**Data**: [Key data points per device type]
**Orders**: [Commands available]
**New equipment types**: [If any]

Voulez-vous que j'implémente ce plugin ?
```

> **GATE 2**: User has explicitly approved the spec.

---

## Phase 3: Branch & Implement

### 3.1 Create Feature Branch (MANDATORY)

**ALWAYS create a branch. NEVER commit directly to main.**

```bash
git checkout main && git pull
git checkout -b feat/plugin-<name>
```

### 3.2 Plugin Code (External Repo)

#### Repo structure

```
sowel-plugin-<name>/
├── manifest.json
├── package.json
├── tsconfig.json
├── .gitignore
└── src/
    └── index.ts
```

#### Plugin interface — MUST match exactly

```typescript
interface IntegrationPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;

  getStatus(): IntegrationStatus;
  isConfigured(): boolean;
  getSettingsSchema(): IntegrationSettingDef[]; // NOT getSettings()

  start(options?: { pollOffset?: number }): Promise<void>;
  stop(): Promise<void>;

  executeOrder( // NOT (sourceId, key, value)
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void>;

  refresh?(): Promise<void>;
  getPollingInfo?(): { lastPollAt: string; intervalMs: number } | null;
}
```

**Common mistakes to avoid:**

- `getSettings()` must be `getSettingsSchema()`
- `executeOrder(deviceSourceId, key, value)` must be `executeOrder(device, dispatchConfig, value)`
- Missing `eventBus.emit()` for connect/disconnect events
- `SettingsManager.get()` returns `undefined` not `null`

#### Device discovery

```typescript
deviceManager.upsertFromDiscovery(INTEGRATION_ID, SOURCE, discoveredDevice);
deviceManager.updateDeviceData(INTEGRATION_ID, sourceDeviceId, { key1: value1 });
```

### 3.3 New Equipment Types (if needed)

**Every new equipment type requires changes in ALL touchpoints listed in [reference.md](reference.md).**
Missing any touchpoint will cause broken UI. Check the list before considering the task done.

### 3.4 Registry (MANDATORY fields since spec 089)

Add entry to `plugins/registry.json` with **all** required fields:

```json
{
  "id": "...",
  "type": "integration",
  "name": "...",
  "description": "...",
  "icon": "...",
  "author": "...",
  "repo": "owner/sowel-plugin-...",
  "owner": "owner",
  "version": "0.1.0",
  "sha256": "<computed by script>",
  "tags": ["..."],
  "sowelVersion": ">=1.6.0"
}
```

**`sha256` and `owner` are mandatory** since spec 089. Compute the hash by running `node scripts/backfill-registry-sha256.mjs` after the plugin's GitHub release exists — the script fetches the latest tarball for every entry and writes the SHA256 in place. Idempotent unless `FORCE=1`.

If `owner` is outside `OFFICIAL_OWNERS` (currently `["mchacher"]`, hard-coded in `src/packages/registry-types.ts`), the plugin will be flagged "community" in the UI with an explicit confirmation modal at install. That's the intended trust boundary — don't try to bypass it.

**On every plugin release**, the registry MUST be re-hashed and PR'd, or installs of the new version will fail with `ChecksumMismatchError` until the registry catches up.

> **GATE 3**: Code is on a feature branch. Plugin repo is created. Registry entry has `sha256` and `owner`. Verify with `git branch --show-current`.

---

## Phase 4: Test & Validate (MANDATORY)

### 4.1 ALL checks must pass

```bash
npx tsc --noEmit                                              # Backend
cd ui && npx tsc --noEmit                                     # Frontend
cd "$(git rev-parse --show-toplevel)" && npx vitest run          # Tests (from repo root)
npx eslint src/ --ext .ts                                     # Lint
```

### 4.2 Functional Test Checklist

1. Install plugin from store
2. Configure settings
3. Start integration → devices appear
4. Create equipment → auto-binding works
5. Equipment detail page shows data + controls
6. Zone/home view shows compact info card
7. Dashboard widget renders (desktop + mobile)
8. Orders work
9. Plugin update works

> **GATE 4**: TypeScript + tests + lint pass with zero errors. Functional checklist completed.

---

## Phase 5: Commit, PR & Merge

### 5.1 Plugin Release (external plugin repo)

```bash
cd sowel-plugin-<name>
npm run build

# Build the release tarball — name MUST match sowel-plugin-<id>-<version>.tar.gz
tar -czf sowel-plugin-<name>-0.1.0.tar.gz manifest.json package.json dist/

git add -A && git commit -m "feat: v0.1.0"
git tag v0.1.0 && git push && git push --tags
gh release create v0.1.0 sowel-plugin-<name>-0.1.0.tar.gz --title "v0.1.0" --notes "Initial release"
```

### 5.2 Compute SHA256 (MANDATORY — spec 089)

Once the GitHub release exists, **come back to the sowel repo** and fill in the `sha256`:

```bash
cd <sowel-repo-root>    # back to the sowel repo, on feat/plugin-<name>
node scripts/backfill-registry-sha256.mjs
```

The script fetches the latest release for every registry entry, downloads the tarball, computes SHA256, and writes it in place. Idempotent (entries already hashed are skipped unless `FORCE=1`).

Verify the new entry now has both `owner` and `sha256` (64 hex chars). **Without this step, installs will fail with `ChecksumMismatchError`.**

### 5.3 Sowel PR

```bash
git add plugins/registry.json src/ ui/ specs/
git push -u origin feat/plugin-<name>
gh pr create --title "feat: plugin <name> integration" --body "..."
```

### 5.4 Wait for Merge Approval

**CRITICAL: Do NOT merge without explicit user confirmation.**

```
PR créée: [URL]. Voulez-vous que je merge dans main ?
```

> **GATE 5**: User has explicitly approved the merge.

### 5.5 Merge

```bash
gh pr merge <number> --merge --delete-branch
git checkout main && git pull
```

---

## Phase 6: Subsequent plugin releases (after this skill ends)

When the plugin author later cuts a new release (v0.2.0, v0.3.0, …), the Sowel registry MUST be kept in sync:

1. In the plugin repo: build, tag, `gh release create v<new> sowel-plugin-<name>-<new>.tar.gz`.
2. In the sowel repo on a `chore(registry): bump <name> to <new>` branch: run `node scripts/backfill-registry-sha256.mjs`, commit `plugins/registry.json`, open a PR.
3. Once merged, the new version is live for all Sowel instances within ~1h (CDN cache).

Skipping step 2 will cause **all installs of the new version to fail** with `ChecksumMismatchError` — the SHA256 in the registry won't match the new tarball.

If the script breaks because the GitHub release was deleted or moved, the entry must be removed from the registry until the release is republished.
