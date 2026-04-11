# Spec 060 — Self-update via helper container + detection improvements

## Context

The self-update feature shipped in spec 057 has a fatal race condition discovered during the v1.0.6 deployment test (2026-04-11):

- `update-manager.ts` calls `currentContainer.stop()` from inside the very container being stopped
- Docker daemon sends SIGTERM → Sowel's shutdown handler runs → `process.exit(0)`
- The subsequent steps (`remove`, `createContainer`, `start`) are never executed
- Docker treats the API stop as "explicit stop" → restart policy `unless-stopped` does NOT restart it
- Result: Sowel stays down, image 1.0.6 is on disk but unused, manual `docker compose pull && up -d` required

In addition, version detection has 3 UX gaps:

- Backend polls GitHub every **24h** — too slow for a home server doing 1-2 restarts/month
- No way to manually trigger a check from the UI
- UI relies on a 30 min poll, no real-time push

## Goals

1. **Make self-update reliable**: it must work end-to-end without manual intervention
2. **Make backups automatic before update**: zero data loss risk
3. **Make detection responsive**: new versions appear in the UI within seconds, not hours
4. **Keep the architecture simple**: no separate supervisor service to maintain

## Non-Goals

- Support for non-`docker compose` deployments (e.g., bare `docker run`) — out of scope
- Per-tenant or multi-instance updates — Sowel is single-tenant
- Rollback to previous version (different from restoring a backup) — out of scope
- Automatic updates without user confirmation — always opt-in via UI click

## Functional Requirements

### FR1 — Helper container pattern (replaces direct dockerode stop/remove/create/start)

When the user clicks **Update** in the UI:

1. Sowel emits an automatic backup to `data/backups/sowel-backup-pre-v{version}-{timestamp}.zip`
2. Sowel reads its own container's labels to detect the compose project
3. Sowel spawns a temporary `docker:25-cli` helper container with:
   - Docker socket mounted (`/var/run/docker.sock`)
   - Compose working directory mounted from the host
   - A shell command that sleeps briefly (let API response return), then runs `docker compose pull && docker compose up -d`
4. Sowel returns the API response immediately (the helper runs detached and survives Sowel's death)
5. Helper container stops Sowel, recreates it with the new image, exits and is auto-removed

### FR2 — Auto backup before update

- **When**: triggered automatically before the helper container is spawned
- **Where**: `data/backups/sowel-backup-pre-v{newVersion}-{YYYYMMDD-HHmmss}.zip`
- **Format**: identical to the manual backup ZIP (SQLite JSON + InfluxDB line protocol + data files)
- **Rotation**: keep the **3 most recent** backups in `data/backups/`, oldest are deleted
- **Failure handling**: if backup fails, abort the update and return an error to the UI

### FR3 — UI: list and restore local backups

- New section in the Backup page: **"Backups locaux"** showing files present in `data/backups/`
- Each row shows: filename, size, creation date, **"Restaurer"** button
- Clicking restore: confirmation modal → POST to a new endpoint that restores from the local file (no upload)
- Section is admin-only

### FR4 — Compose-only with clear feedback

- If Sowel detects it is **not** running under docker compose (no `com.docker.compose.*` labels on its container), the **Update** button in the UI is **disabled** with a tooltip:
  > Self-update is only available for docker compose deployments. Update manually with `docker compose pull && docker compose up -d`.
- The `/api/v1/system/version` response includes a new field `composeManaged: boolean`
- The button stays enabled if compose is detected and Docker socket is available

### FR5 — Updating overlay in the UI

- When the user confirms the update, the UI shows a full-screen overlay:
  > Mise à jour vers v{newVersion} en cours...
  > La page va se recharger automatiquement.
- The overlay stays until the WebSocket reconnects to a sowel reporting the new version
- On reconnect with new version → `window.location.reload()`
- Timeout: if the overlay is visible for > 3 minutes, show a fallback "Reload manually" button

### FR6 — Reduce backend version poll interval

- Current: 24h (`CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000`)
- New: **1h** (`CHECK_INTERVAL_MS = 60 * 60 * 1000`)

### FR7 — Manual "Check for updates" endpoint and button

- New endpoint: `POST /api/v1/system/version/check` (admin only)
- Forces a synchronous call to `versionChecker.check()` and returns the updated `VersionInfo`
- New button in the UI Administration / Système panel: **"Vérifier maintenant"** with loading state
- The button calls the endpoint and updates the local store immediately

### FR8 — WebSocket push of `system.update.available`

- The version-checker already emits `system.update.available` on the EventBus when a newer version is detected
- The WebSocket handler must broadcast this event to all connected clients
- The UI WebSocket store must listen for this event and update the `updateAvailable` state immediately
- The 30-min client-side poll in `useUpdateAvailable.ts` is **removed** (replaced by: check at mount + WS push)

## Acceptance Criteria

- [ ] FR1: Self-update completes successfully end-to-end without manual intervention. After clicking "Update", the new version is running within 60-90s, all volumes preserved, all plugins reload as `connected`.
- [ ] FR2: A backup file is created in `data/backups/` before each update. Filename includes target version + timestamp.
- [ ] FR2: Rotation keeps only the 3 most recent files in `data/backups/`.
- [ ] FR2: If backup fails (disk full, etc.), update is aborted with a clear error message.
- [ ] FR3: Backup page shows a "Local backups" section listing files from `data/backups/`.
- [ ] FR3: Clicking "Restore" on a local backup successfully restores the system.
- [ ] FR4: `/api/v1/system/version` returns `composeManaged: false` if no compose labels detected; UI button is disabled.
- [ ] FR4: With compose labels present, button is enabled.
- [ ] FR5: After clicking Update, overlay appears, persists during the swap, page reloads automatically when WS reconnects with the new version.
- [ ] FR6: Backend logs show `version-checker` polling every 1h instead of 24h.
- [ ] FR7: `POST /api/v1/system/version/check` returns the updated VersionInfo within ~2s and triggers a fresh GitHub poll.
- [ ] FR7: UI button "Check for updates now" works and updates the displayed version state.
- [ ] FR8: When backend detects a new version, all connected UI clients see the badge appear within 1s without a refresh.
- [ ] FR8: Client-side 30-min poll is removed.
- [ ] All existing tests pass, new tests cover the helper container spawn logic and backup rotation.
- [ ] Documentation updated (CLAUDE.md if relevant, docs/technical/architecture.md for the helper pattern).

## Edge Cases

- **Backup fails (disk full)**: abort update, return error 500 with explicit message
- **Helper container fails to spawn (image pull fails)**: abort update, log error, sowel continues running
- **Helper container starts but `docker compose pull` fails**: helper exits non-zero, Sowel container is still up (never stopped). Helper logs are accessible via `docker logs sowel-updater`.
- **GitHub API rate limit hit during check**: 429 → log warn, return previous cached version info
- **WS push happens but client is disconnected**: client gets the latest state on next reconnect via the version check at mount
- **Multiple admins click update simultaneously**: existing `isUpdating()` check returns 409 to second caller
- **`data/backups/` does not exist on first update**: created automatically with 0700 permissions
- **Docker socket not available**: button disabled with tooltip, no change from current behavior
