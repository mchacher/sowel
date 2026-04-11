# Architecture — Spec 060

## Self-update flow (with helper container)

```
┌──────┐                ┌─────────────┐                  ┌──────────────┐                ┌──────────────┐
│  UI  │                │ sowel API   │                  │ Docker daemon│                │ helper       │
└───┬──┘                └──────┬──────┘                  └──────┬───────┘                └──────┬───────┘
    │  POST /system/update    │                                 │                               │
    │ ────────────────────────►                                 │                               │
    │                         │ 1. Check role + composeManaged  │                               │
    │                         │ 2. backupManager.exportToFile() │                               │
    │                         │ 3. inspect self container       │                               │
    │                         │    → read compose labels        │                               │
    │                         │ 4. spawn helper container       │                               │
    │                         │    via docker.createContainer() │                               │
    │                         │ ────────────────────────────────►                               │
    │                         │                                 │ create container "sowel-updater"
    │                         │                                 │ ──────────────────────────────►
    │                         │                                 │                               │ exists
    │                         │ 5. helper.start()               │                               │
    │                         │ ────────────────────────────────►                               │
    │                         │                                 │ start container               │
    │                         │                                 │ ──────────────────────────────►
    │                         │                                 │                               │ running:
    │                         │                                 │                               │   sleep 5
    │                         │                                 │                               │   docker compose pull
    │                         │                                 │                               │   docker compose up -d
    │ ◄──{ success: true }────│                                 │                               │
    │                         │                                 │                               │
    │ overlay "Updating..."   │ (back to event loop)            │                               │
    │ tries WS reconnect      │                                 │                               │
    │                         │                                 │ ◄─── docker stop sowel ───────│
    │                         │ SIGTERM                         │                               │
    │                         │ shutdown handlers run           │                               │
    │ X WS lost               │ process.exit(0)                 │                               │
    │                         │                                 │                               │
    │                         │                          [ Sowel is gone ]                      │
    │                         │                                 │                               │
    │                         │                                 │ ◄─── docker compose up -d ────│
    │                         │                                 │ pull new image                │
    │                         │                                 │ create new sowel container    │
    │                         │                                 │ start it                      │
    │                         │                                 │                               │ exits 0
    │                         │                                 │                               │ auto-removed
    │                         │                                 │                               │
    │                         │ [ New Sowel v1.0.6 starts ]     │                               │
    │ ✓ WS reconnect          │ Server listening                │                               │
    │ ◄ pong                  │                                 │                               │
    │ check version → 1.0.6   │                                 │                               │
    │ window.location.reload()│                                 │                               │
```

## Components

### 1. `update-manager.ts` (heavy refactor)

**Removed:**

- The current sequential `stop → remove → create → start` from inside the dying process
- The `findCurrentContainer()` fallback by image name (use compose labels instead)

**Added:**

- `checkComposeManaged(): boolean` — inspects current container, returns true if `com.docker.compose.project.working_dir` label is present
- `getComposeContext(): { workingDir: string, projectName: string } | null` — reads labels
- `spawnHelper(targetVersion: string): Promise<void>` — creates and starts the `docker:25-cli` helper, returns when helper is started (not when finished)
- `update(targetVersion: string)` rewritten to: backup → spawn helper → return

**Helper container config:**

```typescript
{
  Image: "docker:25-cli",
  name: "sowel-updater",
  HostConfig: {
    AutoRemove: true,
    Binds: [
      "/var/run/docker.sock:/var/run/docker.sock",
      `${composeWorkingDir}:/workdir`,
    ],
  },
  WorkingDir: "/workdir",
  Cmd: [
    "sh", "-c",
    "sleep 5 && docker compose pull && docker compose up -d sowel"
  ],
}
```

**Why `sleep 5`**: gives Sowel time to send the API response back to the UI before the helper starts the swap.

**Why `up -d sowel` (not full `up -d`)**: avoid recreating influxdb unnecessarily.

### 2. New: `backup-manager.ts` (extract from `backup.ts`)

**Why**: the route `backup.ts` currently embeds all the export logic inline. We need to call it programmatically from `update-manager` without going through HTTP. Extract a pure service.

**API:**

```typescript
class BackupManager {
  constructor(deps: BackupDeps);

  // Export to a stream (used by GET /api/v1/backup route)
  exportToStream(): Promise<Readable>;

  // Export to a file in data/backups/ (used by update-manager and future cron backups)
  exportToFile(filename: string): Promise<{ path: string; size: number }>;

  // Restore from a stream (used by POST /api/v1/backup route)
  restoreFromBuffer(buffer: Buffer): Promise<RestoreResult>;

  // Restore from a file in data/backups/ (NEW — used by FR3)
  restoreFromFile(filename: string): Promise<RestoreResult>;

  // List local backups
  listLocalBackups(): { filename: string; size: number; createdAt: string }[];

  // Delete oldest backups, keep N most recent
  rotateLocalBackups(keep: number): { deleted: string[] };
}
```

The existing `backup.ts` route becomes a thin wrapper around `BackupManager`.

### 3. `version-checker.ts` (small changes)

- `CHECK_INTERVAL_MS`: `24h` → `1h`
- New public method `checkNow(): Promise<VersionInfo>` — wraps the private `check()` and returns the updated info
- `getVersionInfo()` adds a new field `composeManaged: boolean` (delegated to `update-manager.checkComposeManaged()`)

### 4. WebSocket: broadcast `system.update.available`

In `src/api/websocket-handler.ts` (or wherever the EventBus subscriptions are):

```typescript
eventBus.on("system.update.available", (event) => {
  broadcast({
    type: "system.update.available",
    current: event.current,
    latest: event.latest,
    releaseUrl: event.releaseUrl,
  });
});
```

The event already exists (emitted by version-checker), we just need to push it to the WS clients.

### 5. New API routes

- `POST /api/v1/system/version/check` (admin) → calls `versionChecker.checkNow()`, returns `VersionInfo`
- `GET /api/v1/backup/local` (admin) → returns `listLocalBackups()`
- `POST /api/v1/backup/restore-local` (admin) → body `{ filename: string }` → calls `restoreFromFile()`

### 6. UI changes

- **`src/store/websocket.ts`** (or equivalent): listen to `system.update.available` event, update `useUpdateAvailable` state
- **`src/hooks/useUpdateAvailable.ts`**: remove the 30-min `setInterval`, keep the mount-time check, add a subscription to the WS store
- **Admin / Système panel**: add "Vérifier maintenant" button next to version display
- **Admin / Système panel**: handle `composeManaged: false` → disable Update button + tooltip
- **Update modal**: replace simple confirmation with a modal that shows the auto-backup message ("Un backup sera créé avant la mise à jour")
- **Update overlay**: full-screen overlay during update, hooks into WS reconnection
- **Backup page**: new section "Backups locaux" with list + restore action

## Data model

No new tables or migrations.

## Files changed (estimate)

| Domain     | File                                               | Change                          |
| ---------- | -------------------------------------------------- | ------------------------------- |
| Core       | `src/core/update-manager.ts`                       | Heavy refactor                  |
| Core       | `src/core/version-checker.ts`                      | Add checkNow + interval + field |
| Backup     | `src/backup/backup-manager.ts` (NEW)               | Extract from route              |
| Backup     | `src/api/routes/backup.ts`                         | Use BackupManager               |
| API        | `src/api/routes/system.ts`                         | New /version/check endpoint     |
| API        | `src/api/routes/backup.ts`                         | New /local + /restore-local     |
| WS         | `src/api/websocket-handler.ts`                     | Broadcast system.update         |
| Shared     | `src/shared/types.ts`                              | composeManaged field            |
| UI types   | `ui/src/types.ts`                                  | composeManaged field            |
| UI store   | `ui/src/store/system.ts` (or similar)              | WS listener for update          |
| UI hook    | `ui/src/hooks/useUpdateAvailable.ts`               | Remove 30min poll               |
| UI page    | `ui/src/pages/Administration/System.tsx`           | Check now button + disabled     |
| UI page    | `ui/src/pages/Administration/Backup.tsx`           | Local backups section           |
| UI overlay | `ui/src/components/system/UpdateOverlay.tsx` (NEW) | Updating overlay                |
| Tests      | `src/core/update-manager.test.ts` (NEW)            | Spawn helper logic              |
| Tests      | `src/backup/backup-manager.test.ts` (NEW)          | Rotation logic                  |

## Why this design

- **Helper container survives our death** because it's a separate process in a separate container, started by the daemon, reading from a Docker socket independently
- **Compose-based** means we leverage the same tool the user uses for their deployment, avoiding any reconfiguration drift between manual updates and self-updates
- **Backup is local file, not stream** so it survives the update (the volume is preserved) and the user can restore later from the UI
- **No long-running supervisor** keeps the architecture minimal — only one container in normal operation
- **WS push** keeps the UI reactive without polling, consistent with the rest of Sowel's reactive pipeline
