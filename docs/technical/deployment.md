# Deployment Guide

This guide covers deploying, updating, backing up, and troubleshooting Sowel in production.

---

## Initial deployment

Sowel ships as a Docker image at `ghcr.io/mchacher/sowel:latest`. A production deployment consists of two containers (`sowel` + `sowel-influxdb`) orchestrated by `docker compose`.

### Prerequisites

- Linux or macOS host with Docker Engine 20.10+ and `docker compose` v2 (multi-arch images: `linux/amd64` and `linux/arm64` — Raspberry Pi 4/5 supported natively)
- At least 2 GB RAM, 10 GB disk (InfluxDB data grows over time)
- Network access to `ghcr.io` for image pulls and `api.github.com` for version checks

### Option A — One-command install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/mchacher/sowel/main/scripts/install.sh | sh
```

What it does:

- Checks that Docker and Docker Compose v2 are installed and reachable
- Creates `~/sowel/` (override with `SOWEL_DIR=/opt/sowel`)
- Downloads the reference `docker-compose.yml`
- Auto-detects the host timezone and patches the compose file (no more UTC logs)
- Pulls images, starts the stack, waits for `/api/v1/health` to respond
- Prints the URL plus the most useful commands (logs / update / stop)

Override the host port: `SOWEL_PORT=8080 curl -fsSL ... | sh`.

If a previous install is detected at `$SOWEL_DIR`, the script refuses to overwrite — pick a different directory or remove it first.

### Option B — Manual deployment

For full control over each step:

```bash
# 1. Pick a deployment directory (convention: /opt/sowel)
sudo mkdir -p /opt/sowel
sudo chown $USER:$USER /opt/sowel
cd /opt/sowel

# 2. Download the reference docker-compose.yml
curl -O https://raw.githubusercontent.com/mchacher/sowel/main/docker-compose.yml

# 3. Optional: set your timezone (recommended — fixes calendar scheduling,
#    HP/HC tariff classification, sunrise/sunset display)
#    Edit docker-compose.yml and uncomment / add:
#      - TZ=Europe/Paris

# 4. Launch
docker compose up -d

# 5. Check containers are up
docker compose ps

# 6. Open the UI and create the first admin
open http://<host>:3000
```

On first boot, Sowel:

- Creates its SQLite DB at `/app/data/sowel.db` (on the `sowel-data` volume)
- Generates a persisted JWT secret (`data/.jwt-secret`) and InfluxDB admin token
- Waits for you to create the first admin via the UI setup screen

### Volumes

| Volume          | Mount                | Content                                                 |
| --------------- | -------------------- | ------------------------------------------------------- |
| `sowel-data`    | `/app/data`          | SQLite DB, logs, secrets, backups, data files           |
| `sowel-plugins` | `/app/plugins`       | Installed plugin files (`dist/`, `manifest.json`, etc.) |
| `influxdb-data` | `/var/lib/influxdb2` | Time-series storage                                     |

These are **named Docker volumes**, persistent across container recreation. They are what make self-update and backup/restore work — the stateful data survives.

### Container user (spec 105)

Since v1.7.0, the Sowel container runs as a non-root user (`sowel`, uid 1000). The image's entrypoint (`docker-entrypoint.sh`) starts briefly as root, runs `chown -R sowel:sowel /app/data /app/plugins` idempotently, then drops to the `sowel` user via `gosu`. This makes upgrades from older root-running versions transparent: `docker compose pull && docker compose up -d` is enough, no manual `chown` is required on existing root-owned volumes.

If you override `user:` in a `docker-compose.override.yml` to run as a different UID, the entrypoint skips the chown and you must manage volume ownership yourself.

### Self-update (default on since v1.15.3)

The official `docker-compose.yml` mounts `/var/run/docker.sock` into the Sowel container so that the **"Update now"** button in the Admin UI works out of the box.

**Security trade-off**: mounting the Docker socket gives the container effective control over the Docker daemon on the host. A successful RCE against Sowel (e.g. via a compromised dependency) would escalate to root on the host. For a single-user home install behind a trusted network or a Cloudflare Tunnel + admin auth this is generally acceptable, but it is a conscious trade-off.

To **opt out** (e.g. on a hardened or multi-tenant deployment), remove the `/var/run/docker.sock:/var/run/docker.sock` line from `docker-compose.yml` and run `docker compose up -d`. The "Update now" button becomes disabled and `POST /api/v1/system/update` returns 503; manual updates still work:

```bash
docker compose pull && docker compose up -d sowel
```

This default was changed in v1.15.3, reversing the v1.7.0 (spec 105) decision after field feedback showed that nearly all installs hit the "update unavailable" message without realising they needed to copy an override file.

---

## Operations

### Checking status

```bash
docker compose ps
docker logs -f sowel          # live logs from stdout
docker logs --tail 100 sowel  # last 100 lines
```

Or via the API:

```bash
curl -s http://localhost:3000/api/v1/health | jq
```

### Restart

```bash
docker compose restart sowel
```

The ring buffer is in-memory, so restart clears it. The file log (`data/logs/sowel.<yyyy-MM-dd>.N.log`) survives.

### Stop / start

```bash
docker compose stop
docker compose start
```

### Rebuild container (without image change)

```bash
docker compose up -d --force-recreate sowel
```

---

## Updates

Sowel supports **two paths**: self-update from the UI (easy) and manual update via compose (fallback).

### Path 1 — Self-update from UI (preferred)

1. Sign in as admin
2. Open the settings / version badge — if an update is available, a badge shows "vX.Y.Z"
3. Click the badge → confirm in the modal
4. Sowel creates an automatic backup, then spawns a helper container that does the swap
5. The UI shows an "Update in progress" overlay
6. After ~30-90 seconds, the page reloads on the new version

**Requirements**:

- Running under `docker compose` (Sowel detects this via container labels)
- `/var/run/docker.sock` mounted in the sowel container
- `docker-compose.yml` in a bind-mounted or accessible directory on the host

If any requirement is missing, the Update button is disabled with a tooltip explaining what to do.

### Path 2 — Manual update via docker compose (fallback)

```bash
cd /opt/sowel
docker compose pull sowel   # fetch the latest image from ghcr.io
docker compose up -d sowel  # recreate the container
```

Sowel restarts, migrations run automatically, plugins are auto-downloaded if missing (spec 058), and the UI resumes.

**Use this when**:

- Self-update UI is disabled (no docker socket, non-compose deployment)
- Upgrading across a version that itself contains a self-update bug (e.g. from v1.0.6, which had the race condition fixed in v1.0.7)
- You want to pin a specific version — edit `docker-compose.yml` to `ghcr.io/mchacher/sowel:1.0.7` before `pull`

---

## Backup & Restore

Backups capture SQLite, InfluxDB data, and all dynamic `data/*` files into a single ZIP.

### Manual backup (export)

**From the UI**: Admin → Backup → "Download a backup". The browser downloads a `sowel-backup-<date>.zip` file.

**From the API**:

```bash
TOKEN=$(curl -s http://<host>:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"<pwd>"}' | jq -r .accessToken)

curl -s http://<host>:3000/api/v1/backup \
  -H "Authorization: Bearer $TOKEN" \
  -o sowel-backup.zip
```

### Automatic pre-update backups (local)

Before every self-update, Sowel creates a backup in `data/backups/sowel-backup-pre-v<version>-<timestamp>.zip`. The three most recent are kept; older are rotated out.

**Listing local backups**:

- From the UI: Admin → Backup → "Local backups" section
- Via the API: `GET /api/v1/backup/local`

**Restoring a local backup**:

- From the UI: click "Restore" next to the backup in the list
- Via the API: `POST /api/v1/backup/restore-local { "filename": "sowel-backup-pre-v1.0.7-2026-04-11T08-28-45.zip" }`

### Manual restore (import)

**From the UI**: Admin → Backup → "Upload a backup".

**From the API**:

```bash
curl -s -X POST http://<host>:3000/api/v1/backup \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@sowel-backup.zip"
```

After restore, Sowel reports `{ restartRequired: true }`. You must restart the container for the restored state to take full effect:

```bash
docker compose restart sowel
```

### Archive contents

See the "Backup & Restore" section in [architecture.md](architecture.md) for the full format.

---

## Logging access

### Three sources

| Source                                       | Retention                           | Use case                                                                              |
| -------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| **Ring buffer** (memory)                     | Lost on restart                     | Live tail via UI Admin → Logs                                                         |
| **Docker stdout**                            | Per-container (lost on recreate)    | `docker logs sowel`                                                                   |
| **`pino-roll` files** on `sowel-data` volume | 14 daily files, survives recreation | **Post-incident investigation** — the only source that survives self-update recreates |

### Accessing the file logs

```bash
# List files
docker exec sowel ls -la /app/data/logs/

# View today's log
docker exec sowel cat /app/data/logs/sowel.6.log

# Grep errors/warns in a time window
docker exec sowel sh -c 'cat /app/data/logs/sowel.6.log | grep -E "2026-04-11T07:" | grep -E "\"level\":\"(error|warn)\""'
```

### Via the helper script

From the repo (on your dev machine):

```bash
SOWEL_URL=http://<host>:3000 SOWEL_PASSWORD='<pwd>' \
  python3 scripts/logs/fetch-logs.py "" error 100

# Filter by module
SOWEL_URL=http://<host>:3000 SOWEL_PASSWORD='<pwd>' \
  python3 scripts/logs/fetch-logs.py recipe-manager debug 50
```

This queries the **ring buffer** via the API — so only logs since the last restart.

### Temporarily raising the log level

```bash
curl -s -X PUT http://<host>:3000/api/v1/logs/level \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"level":"debug"}'
```

This affects the ring buffer only (always at debug by default) — the file transport is at the root level set via `LOG_LEVEL` env var.

---

## Version check

```bash
TOKEN=$(curl -s -X POST http://<host>:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"<pwd>"}' | jq -r .accessToken)

curl -s http://<host>:3000/api/v1/system/version \
  -H "Authorization: Bearer $TOKEN" | jq
```

Expected response:

```json
{
  "current": "1.0.8",
  "latest": "1.0.8",
  "updateAvailable": false,
  "releaseUrl": "https://github.com/mchacher/sowel/releases/tag/v1.0.8",
  "dockerAvailable": true,
  "composeManaged": true
}
```

Force a fresh GitHub poll:

```bash
curl -s -X POST http://<host>:3000/api/v1/system/version/check \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## Troubleshooting

### Container keeps restarting

```bash
docker logs --tail 50 sowel
```

Common causes:

- Database migration error — check for `migration failed` in logs
- Missing `/var/run/docker.sock` but self-update is enabled — should only warn, not crash
- InfluxDB not reachable — check `sowel-influxdb` is up

### Integration not connecting

1. Check status in UI Admin → Integrations or via `GET /api/v1/integrations`
2. Check logs for the specific plugin module: `plugin:<id>`
3. Check settings are configured under `integration.<id>.*` in the `settings` table

### Self-update fails

Symptoms: click "Update", overlay shows, but page never reloads. Container still on old version.

Recovery:

```bash
cd /opt/sowel
docker compose up -d  # recreates the current container if helper failed mid-way
# Or manual upgrade:
docker compose pull && docker compose up -d
```

Investigation:

- Helper container logs are **lost** if `AutoRemove: true` (current default, spec 060)
- Check sowel's own logs right before the helper was spawned: `Update helper spawned` is the last line before the swap
- If sowel never came back, check `docker ps -a` to see if the container is Exited

### Database corrupted

SQLite is WAL mode — safe for abrupt shutdowns in most cases. If corruption:

```bash
# Stop sowel
docker compose stop sowel

# Backup the corrupted DB
docker run --rm -v /opt/sowel_sowel-data:/data alpine cp /data/sowel.db /data/sowel.db.broken

# Restore from the most recent local backup
docker run --rm -v /opt/sowel_sowel-data:/data alpine ls /data/backups/

# Then use the restore flow (see above)
```

### InfluxDB bucket missing after restore

If you restore to a fresh machine, InfluxDB may not have buckets yet. The current restore flow (spec 059) calls `ensureBuckets()` and `ensureEnergyBuckets()` before writing data, so this should be automatic. If not, check `sowel-influxdb` logs.

### Time-based logic broken (shutters at wrong time, HP/HC wrong)

The container defaults to UTC. Set `TZ=Europe/Paris` (or your timezone) in `docker-compose.yml` → restart. See [architecture.md § Timezone handling](architecture.md#timezone-handling) and spec 061 at [github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location](https://github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location).

---

## Reference deployment example

A typical single-host home deployment looks like this:

- **Host**: any Linux VM or SBC (x86_64 or ARM64, 4+ GB RAM recommended)
- **Path**: `/opt/sowel/`
- **Access**: LAN `http://<your-host>:3000`
- **Containers**: `sowel` + `sowel-influxdb`
- **Timezone**: `TZ=<your-timezone>` explicitly set in compose (workaround pending spec 061)
- **Current version**: `docker logs sowel | grep "Sowel engine started"`
- **Backups**: local in `data/backups/` (auto), plus manual downloads kept off-host
- **MQTT**: external `mosquitto` running on the same host (not in compose), used by the `zigbee2mqtt` and `lora2mqtt` plugins
- **Zigbee2MQTT**: external daemon on the same host, not managed by Sowel itself

The connectivity graph:

```
         Internet
            |
     Cloudflare Tunnel (optional, see remote access guide)
            |
     your-host (Linux VM)
     +-- docker: sowel           (port 3000)
     +-- docker: sowel-influxdb
     +-- docker: mosquitto       (MQTT broker, 1883)
     +-- systemd: zigbee2mqtt   (reads Zigbee coordinator USB)
     +-- systemd: lora2mqtt     (reads LoRa dongle USB)
     +-- systemd: cloudflared   (tunnel)
```
