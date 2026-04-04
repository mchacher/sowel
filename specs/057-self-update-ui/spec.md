# 057 — Self-Update from UI

## Summary

Allow users to update Sowel from the Settings page. Sowel checks GitHub releases for new versions, shows a notification badge, and can pull + restart its own Docker container via the Docker socket.

## Acceptance Criteria

- [ ] Version check service: polls GitHub releases API (startup + every 24h)
- [ ] `GET /api/v1/system/version` returns current version + latest available + changelog URL
- [ ] Settings page shows current version and available update (if any)
- [ ] "Update" button triggers `POST /api/v1/system/update`
- [ ] Backend pulls new Docker image and recreates container via Docker socket
- [ ] Data volume preserved across update
- [ ] SQLite migrations run automatically on new version startup
- [ ] Graceful fallback if Docker socket not mounted (show manual instructions)
- [ ] Update progress shown via WebSocket events

## Architecture

```
User clicks "Update to v1.1.0"
  → POST /api/v1/system/update
  → Backend reads Docker socket (/var/run/docker.sock)
  → docker pull ghcr.io/mchacher/sowel:1.1.0
  → docker stop + remove current container
  → docker create + start new container (same volumes, ports, env)
  → New container boots, runs migrations, serves UI
  → User sees v1.1.0 in Settings
```

## Dependencies

- Docker socket mounted: `/var/run/docker.sock:/var/run/docker.sock`
- Library: `dockerode` (Node.js Docker client) or direct HTTP to Unix socket
- Requires: ghcr.io images from spec 055

## Edge Cases

- Docker socket not available → show manual update instructions
- Network error during pull → retry with backoff, keep running current version
- User on non-Docker install → version check still works, update button hidden
