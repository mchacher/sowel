# Architecture Overview

This document describes Sowel's technical architecture: the tech stack, project structure, reactive pipeline, key domain concepts, and design system.

---

## Tech Stack

### Backend

| Technology                   | Role                                         |
| ---------------------------- | -------------------------------------------- |
| **Node.js 20+**              | Runtime                                      |
| **TypeScript** (strict mode) | Language                                     |
| **Fastify**                  | HTTP framework                               |
| **SQLite** (better-sqlite3)  | Primary database (synchronous API, WAL mode) |
| **InfluxDB 2.x**             | Time-series storage (history, energy)        |
| **ws**                       | WebSocket server                             |
| **mqtt.js**                  | MQTT client for device integrations          |
| **pino**                     | Structured JSON logging                      |

### Frontend

| Technology       | Role                                          |
| ---------------- | --------------------------------------------- |
| **React 18+**    | UI framework                                  |
| **TypeScript**   | Language                                      |
| **Vite**         | Build tool and dev server                     |
| **Tailwind CSS** | Styling (utility classes only, no custom CSS) |
| **Zustand**      | State management                              |
| **Lucide React** | Icon library (stroke 1.5px)                   |

### Infrastructure

| Technology                  | Role                            |
| --------------------------- | ------------------------------- |
| **Docker + docker-compose** | Containerized deployment        |
| **PM2**                     | Process management (production) |

---

## Key Domain Concepts

| Term          | Role                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Device**    | Physical hardware, auto-discovered from integrations. Exposes raw Data and Orders.                                      |
| **Equipment** | User-facing functional unit. Binds to one or more Devices. Can have computed Data and dispatched Orders.                |
| **Zone**      | Spatial grouping (nestable tree). Auto-aggregates Equipment Data (motion=OR, temperature=AVG, lightsOn=COUNT, etc.).    |
| **Scenario**  | Automation rule: trigger(s) -> condition(s) -> action(s).                                                               |
| **Recipe**    | Reusable Scenario template with typed parameter slots.                                                                  |
| **Mode**      | Named state (e.g. "Night", "Away") with zone-level impacts. Can be activated manually, by calendar, or by button press. |

**Guiding principle**: A Device is what's on the network. An Equipment is what's in the room.

---

## Reactive Pipeline

The core data flow is fully event-driven. Every integration message propagates through the entire stack:

```
Integration message (MQTT, cloud API poll, etc.)
  -> Integration Plugin (receives + parses)
    -> Device Manager (updates DeviceData)
      -> Event Bus: "device.data.updated"
        -> Equipment Manager (re-evaluates bindings + computed Data)
          -> Event Bus: "equipment.data.changed"
            -> Zone Manager (re-evaluates aggregations)
              -> Event Bus: "zone.data.changed"
                -> Scenario Engine (evaluates triggers -> conditions -> actions)
                  -> Actions may emit Orders -> Integration Plugin -> device
            -> WebSocket pushes to UI clients
```

### Event Bus

The Event Bus is a typed `EventEmitter` using TypeScript discriminated unions (`EngineEvent` type). It is the backbone connecting all managers. Key rules:

- All handlers must be non-blocking and must never throw.
- Events are batched (200ms interval) before being sent to WebSocket clients.
- High-frequency data events (`device.data.updated`, `equipment.data.changed`, `zone.data.changed`) are deduplicated per batch -- only the latest value per key is sent.

### Event Types

| Event                             | Payload                                              | When                     |
| --------------------------------- | ---------------------------------------------------- | ------------------------ |
| `device.discovered`               | `device: Device`                                     | New device found         |
| `device.removed`                  | `deviceId, deviceName`                               | Device deleted           |
| `device.status_changed`           | `deviceId, deviceName, status`                       | Online/offline           |
| `device.data.updated`             | `deviceId, deviceName, dataId, key, value, previous` | Property change          |
| `equipment.data.changed`          | `equipmentId, key, value, previous`                  | Bound data changed       |
| `equipment.order.executed`        | `equipmentId, orderAlias, value`                     | Order dispatched         |
| `zone.data.changed`               | `zoneId, key, value, previous`                       | Aggregated data changed  |
| `system.started`                  | --                                                   | Engine boot complete     |
| `system.integration.connected`    | `integrationId`                                      | Integration connected    |
| `system.integration.disconnected` | `integrationId`                                      | Integration disconnected |
| `settings.changed`                | `keys`                                               | Settings updated         |
| `mode.activated`                  | mode details                                         | Mode activated           |
| `mode.deactivated`                | mode details                                         | Mode deactivated         |
| `recipe.state_changed`            | instance details                                     | Recipe state changed     |

---

## Project Structure

```
sowel/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config.ts                # Env config loading
│   ├── core/                    # event-bus, database (SQLite), influx, logger, settings-manager
│   ├── integrations/            # Integration plugins (zigbee2mqtt, panasonic-cc, mcz-maestro, ...)
│   ├── plugins/                 # Plugin manager (third-party plugin loading)
│   ├── devices/                 # Device manager, auto-discovery, category inference
│   ├── equipments/              # Equipment manager, bindings, computed engine, order dispatcher
│   ├── energy/                  # Energy aggregator, tariff classifier (HP/HC)
│   ├── zones/                   # Zone manager, auto-aggregation engine
│   ├── modes/                   # Mode manager, calendar manager
│   ├── recipes/                 # Recipe engine, built-in recipes (motion-light, switch-light)
│   ├── buttons/                 # Button action bindings (physical button -> mode/order)
│   ├── charts/                  # Saved chart configurations
│   ├── history/                 # InfluxDB history writer and query helpers
│   ├── mqtt-publishers/         # Outbound MQTT publishing (broker manager, publisher manager)
│   ├── notifications/           # Notification channels (Telegram, etc.)
│   ├── ai/                      # LLM integration (Claude/OpenAI/Ollama) -- V1.0+
│   ├── auth/                    # JWT + API tokens, middleware, first-run setup
│   ├── users/                   # User CRUD, preferences
│   ├── api/                     # Fastify server, WebSocket handler, route files
│   │   ├── server.ts            # Server setup and route registration
│   │   ├── websocket.ts         # WebSocket handler with topic subscriptions
│   │   └── routes/              # One file per domain (auth, devices, zones, etc.)
│   └── shared/                  # types.ts (all interfaces), constants.ts
├── ui/                          # React frontend (separate Vite project)
│   └── src/
│       ├── store/               # Zustand stores (devices, equipments, zones, WebSocket)
│       ├── components/          # By domain: dashboard/, devices/, equipments/, zones/, scenarios/
│       ├── pages/               # Dashboard, Devices, Equipments, Zones, Scenarios, Settings
│       └── i18n/                # Internationalization (en.json, fr.json)
├── plugins/                     # Third-party plugin install directory
├── recipes/                     # Built-in Recipe JSON templates
├── migrations/                  # SQLite migration SQL files
├── specs/                       # Feature specifications (XXX-version-name/)
└── scripts/                     # Maintenance & diagnostic scripts
    ├── energy/                  # InfluxDB energy backfill, diagnostic, admin
    └── logs/                    # Log retrieval via API
```

---

## Plugin Architecture V2 (current)

Since spec 053, **all integrations and recipes are plugins** distributed via GitHub. Nothing is built-in anymore — a fresh Sowel install has zero plugins and downloads them on demand from a registry.

### Core services

| Service                 | File                                       | Role                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PackageManager**      | `src/packages/package-manager.ts`          | Downloads, installs, updates, and removes packages (integrations + recipes). Fetches manifests from GitHub releases. Maintains DB state in `plugins` table.                                                            |
| **PluginLoader**        | `src/plugins/plugin-loader.ts`             | Integration-specific loader. Imports the plugin JS entry (`dist/index.js`), calls `createPlugin`, registers with `IntegrationRegistry`. Auto-downloads plugin files on startup if missing (e.g. after backup restore). |
| **RecipeLoader**        | `src/recipes/recipe-loader.ts`             | Recipe-specific loader. Same model as PluginLoader but for recipe packages.                                                                                                                                            |
| **IntegrationRegistry** | `src/integrations/integration-registry.ts` | Runtime registry of connected integrations. Handles start/stop with staggering (to avoid simultaneous cloud API calls).                                                                                                |

### Distribution model

Plugins live in separate GitHub repos (e.g. `mchacher/sowel-plugin-zigbee2mqtt`). Each release ships a prebuilt tarball. The **registry** — a list of available packages — is fetched from:

- **Remote**: `https://raw.githubusercontent.com/mchacher/sowel/main/plugins/registry.json` (cache TTL 1h)
- **Fallback**: local `plugins/registry.json` shipped in the Docker image

Installation flow:

1. User clicks "Install" in Admin → Plugins UI
2. PackageManager calls GitHub releases API for the plugin's repo
3. Downloads the latest release tarball + manifest
4. Extracts to `plugins/<id>/` on the `sowel-plugins` volume
5. Inserts a row in the `plugins` SQLite table
6. PluginLoader imports the entry and registers the integration

The `plugins/registry.json` on `main` is the source of truth for the official plugin list. Any user can point to their own fork.

### Plugin manifest format

Each plugin ships a `manifest.json` with `id`, `type` (`integration` or `recipe`), `name`, `description`, `icon` (Lucide name), `author`, `repo`, `version`, `tags`. See [plugin-development.md](plugin-development.md) for the full spec.

### Integration lifecycle

1. **Load** — `PluginLoader.loadAll()` scans the `plugins` table, imports each enabled entry, calls `createPlugin(deps)`, registers with `IntegrationRegistry`.
2. **Start** — `IntegrationRegistry.startAll()` starts plugins sequentially with small delays. Each plugin's `start()` connects, discovers devices, begins polling.
3. **Runtime** — Plugin pushes data via `deviceManager.updateDeviceData()`. Orders go out via `plugin.executeOrder()`.
4. **Stop** — `stop()` cancels timers, closes connections.
5. **Update** — Unload → `PackageManager.updateFiles()` → reload.
6. **Uninstall** — Unload → `PackageManager.removeFiles()`.

Settings for integrations are stored in SQLite `settings` under `integration.<id>.<key>`, configured from the UI.

### Current official plugin ecosystem

| Plugin                  | Repo                                          | Type        |
| ----------------------- | --------------------------------------------- | ----------- |
| `zigbee2mqtt`           | `mchacher/sowel-plugin-zigbee2mqtt`           | integration |
| `lora2mqtt`             | `mchacher/sowel-plugin-lora2mqtt`             | integration |
| `panasonic_cc`          | `mchacher/sowel-plugin-panasonic-cc`          | integration |
| `mcz_maestro`           | `mchacher/sowel-plugin-mcz-maestro`           | integration |
| `legrand_control`       | `mchacher/sowel-plugin-legrand-control`       | integration |
| `legrand_energy`        | `mchacher/sowel-plugin-legrand-energy`        | integration |
| `netatmo_weather`       | `mchacher/sowel-plugin-netatmo-weather`       | integration |
| `netatmo-security`      | `mchacher/sowel-plugin-netatmo-security`      | integration |
| `weather-forecast`      | `mchacher/sowel-plugin-weather-forecast`      | integration |
| `smartthings`           | `mchacher/sowel-plugin-smartthings`           | integration |
| `motion-light`          | `mchacher/sowel-recipe-motion-light`          | recipe      |
| `motion-light-dimmable` | `mchacher/sowel-recipe-motion-light-dimmable` | recipe      |
| `switch-light`          | `mchacher/sowel-recipe-switch-light`          | recipe      |
| `presence-heater`       | `mchacher/sowel-recipe-presence-heater`       | recipe      |
| `presence-thermostat`   | `mchacher/sowel-recipe-presence-thermostat`   | recipe      |
| `state-watch`           | `mchacher/sowel-recipe-state-watch`           | recipe      |

The live list is in `plugins/registry.json` at the repo root.

---

## Database Architecture

### SQLite

- **Library**: `better-sqlite3` with intentionally synchronous API (fast, no callback overhead).
- **WAL mode**: `PRAGMA journal_mode=WAL` for concurrent read/write.
- **Migrations**: SQL files in `migrations/` run automatically on startup.
- **Transactions**: Used for batch operations.
- **IDs**: UUID v4 via `crypto.randomUUID()`.
- **Dates**: ISO 8601 format throughout.

### InfluxDB

Energy and history data flows through a multi-bucket pipeline:

```
sowel (raw)              -- 7-day retention  -- raw data points
  | task: sowel-energy-sum-hourly (every: 1h, lookback: -7h)
sowel-energy-hourly      -- 2-year retention -- hourly sums
  | task: sowel-energy-sum-daily (every: 1d, lookback: -2d)
sowel-energy-daily       -- 10-year retention -- daily sums
```

Additional downsampled buckets (`sowel-hourly`, `sowel-daily`) exist for non-energy time-series data.

InfluxDB is mandatory -- Sowel connects on startup and auto-creates buckets, downsampling tasks, and energy aggregation tasks.

---

## Authentication & Authorization

- **Passwords**: bcrypt (cost 12).
- **JWT**: HS256 via `jsonwebtoken`. Access token TTL: 15 min. Refresh token TTL: 30 days.
- **API tokens**: `swl_` prefix, SHA-256 hash stored, generated via `crypto.randomBytes(32)`. Legacy prefixes `wch_` and `cbl_` also accepted.
- **Auth middleware**: Tries JWT decode first, then API token lookup.
- **Roles**: `admin` > `standard` > `viewer` (hierarchical permissions).
- **First-run setup**: `POST /api/v1/auth/setup` creates the first admin user.

---

## Frontend Architecture

### State Management

- **Zustand** stores per domain: devices, equipments, zones, modes, recipes, etc.
- Stores are updated in real-time by **WebSocket** events.
- WebSocket auto-reconnects with state recovery (incremental or full).

### Styling

- **Tailwind CSS utility classes only** -- no custom CSS files.
- **Mobile-first** responsive design (breakpoints: 640px, 1024px).
- **Dark mode** via Tailwind `class` strategy -- essential for nighttime dashboard use.

### Internationalization

- English and French supported.
- Locale files: `ui/src/i18n/locales/en.json`, `ui/src/i18n/locales/fr.json`.
- Recipe translations travel with the recipe class (see `i18n` field), not in platform locale files.

---

## Design System

| Property           | Value                                                      |
| ------------------ | ---------------------------------------------------------- |
| **Body font**      | Inter                                                      |
| **Monospace font** | JetBrains Mono (values, logs)                              |
| **Primary color**  | `#1A4F6E` (ocean blue), hover: `#13405A`, light: `#E6F0F6` |
| **Accent color**   | `#D4963F` (amber), hover: `#BB8232`                        |
| **Spacing base**   | 4px                                                        |
| **Border radius**  | 6px (buttons), 10px (cards), 14px (modals)                 |
| **Body font size** | 14px (dense dashboard)                                     |
| **Data values**    | 28px (readable at a glance)                                |
| **Icons**          | Lucide React, stroke 1.5px                                 |

---

## Backup & Restore

Backups capture the full system state as a single ZIP archive and restore it atomically.

### Service

`BackupManager` in `src/backup/backup-manager.ts` is the central service. It is called by:

- **HTTP routes** `GET/POST /api/v1/backup` (manual export/import)
- **UpdateManager** (automatic pre-update backup — see self-update section)
- **Local backup routes** `GET /api/v1/backup/local`, `POST /api/v1/backup/restore-local`

### Archive format

A backup ZIP contains:

| Entry                     | Content                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `sowel-backup.json`       | SQLite export as JSON, structured per table (version 2 format)                                                   |
| `influx-raw.lp`           | Raw InfluxDB data as line protocol (last 7 days)                                                                 |
| `influx-hourly.lp`        | Downsampled hourly data (last 90 days)                                                                           |
| `influx-daily.lp`         | Downsampled daily data (last 5 years)                                                                            |
| `influx-energy-hourly.lp` | Energy hourly sums (last 2 years)                                                                                |
| `influx-energy-daily.lp`  | Energy daily sums (last 10 years)                                                                                |
| `data/*`                  | All non-DB files from `data/` (token secrets, etc.) — dynamically scanned, excluding `.db`, `.pid`, `.log` files |

The SQLite JSON export covers a curated list of tables (`BACKUP_TABLES` constant in `backup-manager.ts`) in dependency order (parents first for restore).

### Local backups (data/backups/)

Separate from manual export, `BackupManager.exportToFile()` writes backups to `data/backups/sowel-backup-<name>.zip` on the persistent volume. Used by:

- **UpdateManager** before any self-update: `data/backups/sowel-backup-pre-v<version>-<timestamp>.zip`
- **Rotation** via `rotateLocalBackups(keep)` — keeps only the N most recent files

The UI (Admin → Backup) lists local backups and offers one-click restore via `POST /api/v1/backup/restore-local { filename }`.

### Restore flow

1. Validate ZIP structure and JSON schema
2. Disable FK constraints (outside transaction — SQLite limitation)
3. Delete all rows in reverse dependency order (children first)
4. Insert new rows in parent-first order
5. Run `PRAGMA foreign_key_check` — abort transaction if violations
6. Ensure InfluxDB buckets exist (`influxClient.ensureBuckets()` and `ensureEnergyBuckets()`)
7. POST each `.lp` file to InfluxDB `/api/v2/write` in batches of 5000 lines
8. Restore dynamic data files
9. Respond with `restartRequired: true` — user must restart sowel to reload state

See spec 060 for the latest backup design and `src/backup/backup-manager.ts` for the implementation.

---

## Self-Update (spec 060)

Sowel can update itself from the UI when running under `docker compose`. The design survives the "process kills itself" paradox via a helper container pattern (similar to Watchtower).

### Detection

`VersionChecker` in `src/core/version-checker.ts` polls `https://api.github.com/repos/mchacher/sowel/releases/latest` every 1 hour (also at T+10s after boot). When a newer semver is found, it emits `system.update.available` on the EventBus, which is broadcast to UI clients via WebSocket. The UI displays a badge in real time. A manual "Check now" button hits `POST /api/v1/system/version/check` which forces an immediate poll.

`GET /api/v1/system/version` returns `{ current, latest, updateAvailable, releaseUrl, dockerAvailable, composeManaged }`. `composeManaged` is derived from the running container's labels (`com.docker.compose.*`); if absent, self-update is disabled with a tooltip.

### Upgrade flow

`UpdateManager` in `src/core/update-manager.ts` orchestrates the upgrade:

1. **Pre-update backup** via `backupManager.exportToFile()` → `data/backups/sowel-backup-pre-v<X>-<ts>.zip`
2. **Rotate backups** (keep 3 most recent)
3. **Detect compose context** from current container labels: `com.docker.compose.project.working_dir`, `com.docker.compose.project`, `com.docker.compose.service`
4. **Spawn helper container** via dockerode:
   - Image: `docker:25-cli` (has `docker compose` built-in)
   - Mounts: `/var/run/docker.sock` + the compose working dir as `/workdir`
   - Cmd: `sh -c "sleep 5 && docker compose pull <service> && docker compose up -d <service>"`
   - `AutoRemove: true`
5. **Return from API immediately** — the helper survives sowel's death
6. **UI shows overlay** ("Updating...") during the swap, polls `/system/version` every 3s
7. **On version change** → `window.location.reload()`

Why a helper? Calling `dockerode.stop()` on the current container from within the current process kills the Node runtime via SIGTERM before the remove/create/start sequence can run. The helper is a separate process in a separate container that survives the swap.

**Requirements on the host**:

- `/var/run/docker.sock` mounted into the sowel container
- The compose working dir must be accessible from the host filesystem (any bind mount path works — Sowel reads it from container labels)
- `docker compose up` must use a standard `docker-compose.yml` / `compose.yml` filename (non-standard file names need `-f`, not currently handled)

---

## CI/CD & Releases (spec 055)

### GitHub Actions workflow

`.github/workflows/release.yml` triggers on pushed tags matching `v*`. It runs:

1. **ci job** — typecheck, lint, tests (backend + UI)
2. **docker job** — builds `linux/amd64` image with Buildx, pushes to `ghcr.io/mchacher/sowel:<version>` and `:latest`, then creates a GitHub Release with auto-generated notes

The Docker build is **amd64-only** (spec simplified in April 2026 for ~3x faster builds; arm64 dropped because no users run on Apple Silicon Linux hosts in production).

### Release script

`scripts/release.sh <version>`:

1. Validates semver format and clean working tree
2. Bumps `package.json` + `ui/package.json` versions
3. Runs full validation (`npm run validate`)
4. Commits `release: vX.Y.Z`, tags `vX.Y.Z`, pushes to origin
5. GitHub Actions takes over from there

A Claude Code skill wraps this at `.claude/skills/sowel-release/SKILL.md`.

### Docker image (`Dockerfile`)

Multi-stage build:

1. **backend-build** — Node 20, `tsc` backend
2. **ui-build** — Node 20, Vite UI build
3. **runtime** — Debian Trixie (for Python 3.13), Node 20 installed via NodeSource, Python 3.13 + venv for plugins that need it (e.g. Panasonic CC), `better-sqlite3` rebuilt for the platform

Runtime image is ~950 MB uncompressed (~210 MB content). The Python 3.13 requirement dates from the Panasonic CC plugin needing f-string syntax unavailable in Python 3.11.

---

## Logging

### Strategy

Pino structured JSON logging with multistream output (see `src/core/logger.ts`):

- **Ring buffer** — in-memory circular buffer for UI log viewer (always captures debug level)
- **stdout** — raw JSON in production (captured by Docker logs), pino-pretty in development
- **File transport** — in production only, via `pino-roll` to `data/logs/sowel-N.log`, daily rotation, keep 14 files

### Log file location

`/app/data/logs/sowel-<N>.log` inside the container (on the `sowel-data` volume). **Survives container recreation** — essential for post-incident investigation after a self-update.

Example retrieval:

```bash
docker exec sowel sh -c 'cat /app/data/logs/sowel.6.log | grep -E "2026-04-11T07:" | grep error'
```

### Log level guidance

| Level   | Purpose                                                    |
| ------- | ---------------------------------------------------------- |
| `fatal` | Process crash imminent                                     |
| `error` | Operation failed, engine continues (always with `{ err }`) |
| `warn`  | Self-recovering degradation (reconnect, stale data)        |
| `info`  | Significant business events, one per operation             |
| `debug` | Developer troubleshooting detail                           |
| `trace` | High-volume hot path (every event, every MQTT message)     |

Conventions:

- Every module creates a child logger with `{ module: "module-name" }`
- Structured context as first argument object: `logger.info({ deviceId, status }, "Device status changed")`
- Passwords/tokens/secrets are auto-redacted by pino config
- **Never use `console.*`** — bypasses ring buffer, file rotation, and redaction

### Retrieval helpers

- **From UI** — Admin → Logs page (reads the ring buffer)
- **Via API** — `GET /api/v1/logs?module=X&level=Y&limit=N` (ring buffer only, lost on restart)
- **From file** — `docker exec` into `/app/data/logs/sowel-*.log` (persistent)
- **Helper script** — `scripts/logs/fetch-logs.py <module> <level> <limit>` with `SOWEL_URL` + `SOWEL_PASSWORD` env vars

---

## Timezone handling

Sowel backend logic depends heavily on local time: calendar cron slots (`croner`), energy HP/HC tariff classification, energy day boundaries, sunrise/sunset display, notifications. All use native `Date` methods that depend on `process.env.TZ`.

**Current state (2026-04-11)**: set `TZ=Europe/Paris` in `docker-compose.yml` environment for production sowelox. This is a temporary workaround.

**Target state (spec 061, drafted)**: auto-derive the timezone from `home.latitude` / `home.longitude` at startup via `tz-lookup`, with `TZ` env var as override. Node caches TZ on first Date call, so changes require restart.

See spec 061 at [github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location](https://github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location).

---

## Environment Variables

All settings are optional with sensible defaults -- Sowel runs zero-config out of the box. Override via `.env` if needed:

| Variable          | Default                        | Notes                                                                    |
| ----------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `SQLITE_PATH`     | `./data/sowel.db`              | SQLite database path                                                     |
| `API_PORT`        | `3000`                         | HTTP server port                                                         |
| `API_HOST`        | `0.0.0.0`                      | Bind address                                                             |
| `JWT_SECRET`      | auto-generated                 | Persisted in `data/.jwt-secret` on first launch                          |
| `JWT_ACCESS_TTL`  | `900`                          | Access token TTL in seconds (15 min)                                     |
| `JWT_REFRESH_TTL` | `2592000`                      | Refresh token TTL in seconds (30 days)                                   |
| `LOG_LEVEL`       | `info`                         | Pino log level                                                           |
| `CORS_ORIGINS`    | `*`                            | Comma-separated allowed origins                                          |
| `INFLUX_URL`      | `http://localhost:8086`        | InfluxDB 2.x URL                                                         |
| `INFLUX_TOKEN`    | auto-generated                 | Persisted in `data/.influx-token` on first launch                        |
| `INFLUX_ORG`      | `sowel`                        | InfluxDB organization                                                    |
| `INFLUX_BUCKET`   | `sowel`                        | InfluxDB primary bucket                                                  |
| `TZ`              | system default (UTC in Docker) | IANA timezone. Set explicitly in docker-compose to fix time-based logic. |

Integration settings (MQTT, cloud credentials, polling intervals) are configured from the UI, not from `.env`.
