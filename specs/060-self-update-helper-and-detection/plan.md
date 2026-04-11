# Implementation Plan — Spec 060

## Strategy

Three independent slices, each can be merged separately if needed but will be bundled in a single PR per the user's preference (one spec, one PR).

1. **Slice A — Backup refactor** (foundation for both self-update and local backups)
2. **Slice B — Self-update via helper container** (the critical fix)
3. **Slice C — Detection improvements** (poll 1h + check now + WS push)

Implement in this order: A → B → C. A is foundation (B uses it). C is independent of A/B but easier to test once B is wired up.

---

## Slice A — Backup manager extraction

### A.1 Create `src/backup/backup-manager.ts`

- Extract all logic from `src/api/routes/backup.ts` into a `BackupManager` class
- Constructor takes `{ db, influxClient, logger, dataDir }`
- Methods:
  - `exportToStream(): Promise<archiver.Archiver>` — used by GET route
  - `exportToFile(filename: string): Promise<{ path: string; size: number }>` — writes to `data/backups/{filename}`, creates dir if needed
  - `restoreFromBuffer(buffer: Buffer): Promise<RestoreResult>` — used by POST route
  - `restoreFromFile(filename: string): Promise<RestoreResult>` — loads file from `data/backups/`, calls `restoreFromBuffer`
  - `listLocalBackups(): LocalBackup[]` — scans `data/backups/`, returns sorted by mtime DESC
  - `rotateLocalBackups(keep: number): { deleted: string[] }` — deletes oldest, keeps N most recent

### A.2 Refactor `src/api/routes/backup.ts`

- Replace inline logic with calls to `BackupManager`
- Same external behavior, no breaking change for existing UI/scripts

### A.3 Add 2 new routes in `backup.ts`

- `GET /api/v1/backup/local` (admin) → `listLocalBackups()`
- `POST /api/v1/backup/restore-local` (admin) → body `{ filename }`, calls `restoreFromFile()`

### A.4 Wire up `BackupManager` in `src/index.ts`

- Instantiate after db and influxClient are ready
- Pass to `registerBackupRoutes` and (later in slice B) to `UpdateManager`

### A.5 Tests for `BackupManager`

- New file `src/backup/backup-manager.test.ts`
- Test: `rotateLocalBackups(3)` keeps the 3 newest files
- Test: `listLocalBackups()` returns sorted DESC by mtime
- Test: `exportToFile()` creates the directory if missing
- Test: `restoreFromFile()` rejects if file not found

---

## Slice B — Self-update via helper container

### B.1 Refactor `src/core/update-manager.ts`

- Inject `BackupManager` in constructor
- New private methods:
  - `getComposeContext(): { workingDir: string; projectName: string } | null` — inspects self container, reads compose labels
  - `isComposeManaged(): boolean` — convenience wrapper
  - `spawnHelper(targetVersion: string, composeContext): Promise<void>` — creates and starts the helper container
- Rewrite `update(targetVersion: string)`:
  1. Validate Docker available + composeManaged + not already updating
  2. Trigger backup: `backupManager.exportToFile(\`sowel-backup-pre-v\${targetVersion}-\${ts}.zip\`)`
  3. Rotate backups: `backupManager.rotateLocalBackups(3)`
  4. `getComposeContext()` — abort if null
  5. `spawnHelper(targetVersion, ctx)` — returns when helper is started, not finished
  6. Emit `system.update.progress { step: "spawned", message: "Update started" }`
  7. Return (the helper takes over)
- Remove the old stop/remove/create/start sequence

### B.2 `version-checker.ts` adds `composeManaged` to `VersionInfo`

- Inject `UpdateManager` reference (or factor out the compose check)
- `getVersionInfo()` adds `composeManaged: this.updateManager.isComposeManaged()`

### B.3 `system.ts` route updates

- `GET /api/v1/system/version` already returns `versionChecker.getVersionInfo()` — automatically picks up the new field
- `POST /api/v1/system/update`:
  - Reject with 400 if `composeManaged === false`
  - Otherwise unchanged (calls `updateManager.update(latest)`)

### B.4 Tests for `UpdateManager`

- New file `src/core/update-manager.test.ts`
- Test: `getComposeContext()` returns labels when present, null otherwise
- Test: `update()` aborts if backup fails
- Test: `update()` aborts if not compose managed
- Test: `update()` emits `progress { step: "spawned" }` after spawning
- Mock dockerode for these tests

### B.5 UI: composeManaged + update button

- `ui/src/types.ts`: add `composeManaged: boolean` to `VersionInfo`
- `ui/src/api.ts`: pass-through (already returns the typed object)
- Administration / Système page: if `dockerAvailable && composeManaged` → button enabled, else disabled with tooltip
- Wording: see spec FR4

### B.6 UI: update overlay

- New component `ui/src/components/system/UpdateOverlay.tsx`
- Shown after click confirmation, fixed full-screen with the message from FR5
- Listens to WebSocket reconnect events
- On reconnect, fetches `/api/v1/system/version`. If `current === targetVersion` → `window.location.reload()`
- Timeout 3 min: shows "Reload manually" button

### B.7 UI: confirmation modal mentions auto backup

- Update the existing confirm modal text to mention: "Un backup automatique sera créé avant la mise à jour"

### B.8 UI: Backup page — local backups section

- `ui/src/pages/Administration/Backup.tsx`: add new section
- Calls `GET /api/v1/backup/local` on mount
- Renders list with: filename, size (formatted), date, "Restaurer" button
- Restore button → confirmation modal → POST `/api/v1/backup/restore-local` → reload after success

---

## Slice C — Detection improvements

### C.1 `version-checker.ts`

- `CHECK_INTERVAL_MS`: `24 * 60 * 60 * 1000` → `60 * 60 * 1000`
- New public method `checkNow(): Promise<VersionInfo>`:
  - Calls the existing private `check()` method
  - Returns `getVersionInfo()` after the check completes
  - Errors are propagated (not swallowed) so the UI can show feedback

### C.2 New endpoint `POST /api/v1/system/version/check`

- In `src/api/routes/system.ts`
- Admin only
- Calls `versionChecker.checkNow()`
- Returns the `VersionInfo` object (200) or 500 with error message
- Add light internal rate limiting: max 1 call per 10s (shared global)

### C.3 WebSocket broadcast of `system.update.available`

- Locate the place where the WS handler subscribes to EventBus events
- Add a subscription for `system.update.available`
- On event, call `broadcast()` with `{ type: "system.update.available", current, latest, releaseUrl }`

### C.4 UI: WS listener

- `ui/src/store/websocket.ts` (or wherever WS messages are handled): on `system.update.available`, update the local state for `useUpdateAvailable`
- Could be a Zustand store or a context — match existing patterns

### C.5 UI: simplify `useUpdateAvailable.ts`

- Remove the 30-min `setInterval` polling
- Keep the initial check at mount (for cases where WS is not yet connected)
- Subscribe to the WS store update event

### C.6 UI: "Vérifier maintenant" button

- Administration / Système page
- Button next to the version display
- Loading state during the call (~1-2s)
- On success, refresh the displayed version info
- On error, toast with message

---

## Validation Plan

### Phase 4 — automated checks

```bash
npx tsc --noEmit
cd ui && npx tsc -b --noEmit
npx vitest run
npx eslint src/ --ext .ts
cd ui && npx eslint .
```

All must pass with zero errors.

### Phase 4 — manual test plan

1. **Unit tests** (`vitest run`):
   - BackupManager rotation
   - UpdateManager compose detection and abort cases

2. **Integration test on local Mac with Docker Desktop**:
   - Build sowel image locally with the changes
   - Run via docker compose with Docker socket mounted
   - Click "Check for updates" → verify endpoint and badge
   - Trigger an update to a fake target version → verify helper container spawns, sowel restarts, page reloads
   - Verify backup file appears in `data/backups/`
   - Verify rotation: trigger 4 updates, verify only 3 files remain

3. **Production validation on sowelox**:
   - After v1.0.7 release (which contains this spec): trigger update from v1.0.6 → v1.0.7 via UI
   - Observe overlay, helper logs, sowel restart, page reload
   - Check `data/backups/` contains 1 file
   - Check `docker ps -a` shows `sowel-updater` is removed (AutoRemove worked)

---

## Risks & Mitigations

| Risk                                      | Mitigation                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helper image `docker:25-cli` pull fails   | Check connectivity in `update()` before spawning, return clear error                                                                                                   |
| Compose labels not detected               | `composeManaged: false` → button disabled, no surprise                                                                                                                 |
| Backup is too large to fit on disk        | Add free space check before export; abort with error if < 500MB free                                                                                                   |
| Helper exits non-zero (compose pull fail) | Sowel container is still up (never stopped). User sees the update did not happen. Logs available via `docker logs sowel-updater` (but auto-removed — TODO: keep logs?) |
| WS push race with mount-time check        | Both update the same state, idempotent — last write wins                                                                                                               |
| User triggers update twice quickly        | `isUpdating()` flag prevents duplicate, returns 409                                                                                                                    |

### Open risk: helper container auto-removed

If the helper exits and is auto-removed, we lose the logs. For debugging, we may want to **NOT** auto-remove on failure. Option: set `AutoRemove: false`, then have sowel (the new one) detect a leftover `sowel-updater` container on startup and log/clean it up.

**Decision for spec 060**: keep `AutoRemove: true` for simplicity. If we hit a failure case, we can revisit. Document the workaround: `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock docker:25-cli sh -c "..."` to test manually.

---

## Out of Scope (deferred)

- Support for non-compose deployments (`docker run` direct)
- Rollback to previous version via UI (the local backups serve this purpose)
- Automatic background updates (cron-like)
- Scheduled updates (e.g., "update every Sunday at 3am")
- Multi-container plugin updates (each plugin still updates individually)
