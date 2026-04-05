# 057 — Self-Update from UI

## Summary

Allow users to check for new Sowel versions and update directly from the Settings page. Sowel polls GitHub releases, shows a notification when a new version is available, and can pull + restart its own Docker container via the Docker socket.

## Architecture

```
VersionChecker (service)
  ├── polls GitHub releases API (startup + every 24h)
  ├── caches: currentVersion, latestVersion, releaseUrl
  └── emits: system.update.available (via EventBus → WebSocket)

GET /api/v1/system/version
  → { current, latest, updateAvailable, releaseUrl, dockerAvailable }

POST /api/v1/system/update
  → UpdateManager (uses dockerode)
    1. docker pull ghcr.io/mchacher/sowel:<latest>
    2. Inspect current container (get config: volumes, ports, env, name)
    3. Stop current container
    4. Remove current container
    5. Create new container with same config + new image
    6. Start new container
  → WebSocket progress events at each step

Settings page (UI)
  ├── Current version badge
  ├── "New version available" banner (if updateAvailable)
  ├── "Update" button → POST /api/v1/system/update
  ├── Progress indicator during update
  └── Fallback: "Docker not available" → manual instructions
```

## Dependencies

- `dockerode` npm package (Docker API client)
- Docker socket mounted: `/var/run/docker.sock:/var/run/docker.sock` in docker-compose.yml

## API Endpoints

### GET /api/v1/system/version

```json
{
  "current": "1.0.0",
  "latest": "1.1.0",
  "updateAvailable": true,
  "releaseUrl": "https://github.com/mchacher/sowel/releases/tag/v1.1.0",
  "dockerAvailable": true
}
```

### POST /api/v1/system/update (admin only)

Triggers Docker image pull + container recreation. Returns immediately, progress sent via WebSocket.

```json
{ "success": true, "message": "Update started" }
```

### WebSocket events

```json
{ "type": "system.update.progress", "step": "pulling", "message": "Pulling ghcr.io/mchacher/sowel:1.1.0..." }
{ "type": "system.update.progress", "step": "stopping", "message": "Stopping current container..." }
{ "type": "system.update.progress", "step": "creating", "message": "Creating new container..." }
{ "type": "system.update.progress", "step": "starting", "message": "Starting new container..." }
{ "type": "system.update.progress", "step": "done", "message": "Update complete. Reloading..." }
{ "type": "system.update.error", "error": "Pull failed: network error" }
```

## Edge Cases

- **No Docker socket**: `dockerAvailable: false` in version endpoint, update button hidden, show manual instructions
- **Pull fails**: error event, current container untouched
- **Same version**: update button disabled
- **Non-Docker install** (npm run dev): version check works, update hidden

## Files

| File                            | Change                                                 |
| ------------------------------- | ------------------------------------------------------ |
| `src/core/version-checker.ts`   | NEW — polls GitHub releases, caches versions           |
| `src/core/update-manager.ts`    | NEW — Docker pull + container recreation via dockerode |
| `src/api/routes/system.ts`      | NEW — version + update endpoints                       |
| `src/api/server.ts`             | Register system routes                                 |
| `src/index.ts`                  | Create VersionChecker + UpdateManager                  |
| `src/shared/types.ts`           | Add system event types to EngineEvent                  |
| `docker-compose.yml`            | Add Docker socket volume mount                         |
| `ui/src/pages/SettingsPage.tsx` | Add version + update section                           |
| `ui/src/i18n/locales/fr.json`   | Add translations                                       |
| `ui/src/i18n/locales/en.json`   | Add translations                                       |

## Acceptance Criteria

- [ ] `dockerode` added as dependency
- [ ] VersionChecker polls GitHub releases (startup + 24h interval)
- [ ] `GET /api/v1/system/version` returns version info + Docker availability
- [ ] `POST /api/v1/system/update` triggers Docker update (admin only)
- [ ] WebSocket progress events during update
- [ ] Settings page shows version + update button
- [ ] Graceful fallback when Docker socket not available
- [ ] docker-compose.yml includes Docker socket mount
- [ ] TypeScript compiles, all tests pass, lint clean
