# Architecture — Spec 066

## Overview

Three changes to make the registry independent of Sowel releases:

1. **Warm registry at boot** — `await` the remote fetch before serving any store/update data
2. **sowelVersion compatibility check** — store API + install guard
3. **Documentation** of the new workflow

## Backend changes

### Modified: `src/packages/package-manager.ts`

**Registry warm-up (new):**

```typescript
async warmRegistryCache(): Promise<void>
```

Called once at boot (before plugin/recipe loading). Fetches the remote registry synchronously (with 10s timeout). Falls back to local bundled file if remote is unreachable. After this call, `getRegistryEntries()` is guaranteed to have fresh data.

The existing `getRegistryEntries()` keeps its background-refresh-on-stale behavior for subsequent calls (>1h TTL).

**Compatibility check (new):**

```typescript
getCurrentVersion(): string
```

Reads `version` from `/app/package.json` (or `process.cwd()/package.json`). Cached after first call.

**Store API enrichment:**

`getStore()` returns entries with a `compatible` field:

```typescript
interface StoreEntry extends PluginManifest {
  compatible: boolean;
  compatReason?: string; // "Requires Sowel >= X.Y.Z"
}
```

Compatibility is checked by parsing the `sowelVersion` field from the registry entry (e.g., `">=1.1.0"`) against the current Sowel version. Simple semver `>=` comparison — no dependency.

### Modified: `src/api/routes/plugins.ts`

**Install guard:**

Before installing, check sowelVersion from the registry entry:

```typescript
const entry = packageManager.getStore().find((m) => m.repo === repo);
if (entry && !entry.compatible) {
  return reply.code(400).send({ error: `Requires Sowel >= ${entry.sowelVersion}` });
}
```

### Modified: `src/index.ts`

Add `await packageManager.warmRegistryCache()` before plugin/recipe loading.

## UI changes

### Modified: `ui/src/pages/PluginsPage.tsx`

For incompatible store entries:

- Disable "Install" button
- Show tooltip/text: "Nécessite Sowel >= X.Y.Z"

## Registry entries

### Modified: all plugin/recipe manifests

Add/update `sowelVersion` constraint:

| Plugin        | sowelVersion                                   |
| ------------- | ---------------------------------------------- |
| zigbee2mqtt   | `>=1.1.0` (uses composite payload from v1.1.0) |
| auto-watering | `>=1.1.0` (needs water_valve type + rain_24h)  |
| freecooling   | `>=1.1.0` (needs sunlight data)                |
| All others    | `>=0.10.0` (legacy compat)                     |

## Files changed

| File                               | Change                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `src/packages/package-manager.ts`  | `warmRegistryCache()`, `getCurrentVersion()`, compatibility check in `getStore()` |
| `src/index.ts`                     | Call `warmRegistryCache()` at boot                                                |
| `src/api/routes/plugins.ts`        | Install guard for sowelVersion                                                    |
| `ui/src/pages/PluginsPage.tsx`     | Disable install for incompatible packages                                         |
| `plugins/registry.json`            | Add `sowelVersion` to all entries                                                 |
| `specs/066-registry-independence/` | Spec + architecture docs                                                          |

## No changes needed

- No SQLite migration
- No new API endpoints (existing store endpoint enriched)
- No new events
