# CLAUDE.md

Guidance for Claude Code (and any AI agent) working on the Sowel repository. This is the **first file to read** when starting a session. It is intentionally short — deep context lives in `docs/` and `specs/`.

## Where to find context

| You want to know...                                                | Read this                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| What Sowel is and how it's architected                             | [docs/technical/architecture.md](docs/technical/architecture.md)              |
| The full list of features ever shipped, by spec                    | [docs/specs-index.md](docs/specs-index.md)                                    |
| How to deploy, update, backup, restore, troubleshoot in production | [docs/technical/deployment.md](docs/technical/deployment.md)                  |
| Data model — tables, types, events                                 | [docs/technical/data-model.md](docs/technical/data-model.md)                  |
| REST API and WebSocket events                                      | [docs/technical/api-reference.md](docs/technical/api-reference.md)            |
| How to develop a plugin                                            | [docs/technical/plugin-development.md](docs/technical/plugin-development.md)  |
| How to develop a recipe                                            | [docs/technical/recipe-development.md](docs/technical/recipe-development.md)  |
| Specific feature history / design                                  | `specs/XXX-name/{spec,architecture,plan}.md` — index in `docs/specs-index.md` |

**Do not rely on `docs/sowel-spec.md`** — it is a legacy document preserved for history. Use `docs/technical/*` and `specs/*` instead.

## Project in one paragraph

Sowel is a home automation engine. Physical **Devices** (auto-discovered from integrations like Zigbee2MQTT, Panasonic Comfort Cloud, etc.) are bound to user-facing **Equipments**. Equipments live in **Zones** (nestable tree) that auto-aggregate data (motion=OR, temperature=AVG, etc.). **Recipes** (automation templates) run on top, triggered by events. **Modes** (Day/Night/Away) flip zones between configurations. Everything is event-driven through a typed **EventBus**, and the UI is a reactive React SPA fed by WebSocket. Since spec 053, **everything is a plugin** — integrations and recipes are distributed from GitHub, nothing is built-in.

## Reactive pipeline

```
Integration message (MQTT, cloud API poll, etc.)
  → Integration Plugin (receives + parses)
    → Device Manager (updates DeviceData)
      → Event Bus: "device.data.updated"
        → Equipment Manager (re-evaluates bindings + computed Data)
          → Event Bus: "equipment.data.changed"
            → Zone Manager (re-evaluates aggregations)
              → Event Bus: "zone.data.changed"
                → Recipe Engine (triggers → conditions → actions)
                  → Actions may emit Orders → Integration Plugin → device
            → WebSocket pushes to UI clients
```

## Key domain concepts

| Term          | Role                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| **Device**    | Physical hardware, auto-discovered from integrations. Raw data and orders.             |
| **Equipment** | User-facing functional unit. Binds to one or more Devices. Can have computed data.     |
| **Zone**      | Spatial grouping (nestable tree). Auto-aggregates equipment data.                      |
| **Recipe**    | Reusable automation template with typed parameter slots (instance = running scenario). |
| **Mode**      | Named zone-level state (Day/Night/Away) with impacts on recipes.                       |
| **Plugin**    | A package (integration or recipe) distributed from GitHub via PackageManager.          |

Guiding principle: **a Device is what's on the network. An Equipment is what's in the room.**

## Tech stack

- **Backend**: Node.js 20+, TypeScript strict, Fastify, SQLite (better-sqlite3), InfluxDB 2.x, ws, mqtt.js, pino
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Zustand, Lucide React
- **Infra**: Docker + docker-compose, GitHub Actions release to ghcr.io

## Project structure (current, spec 053+)

```
sowel/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config.ts                # Env config loading
│   ├── core/                    # event-bus, database, influx-client, logger, settings-manager,
│   │                            # version-checker, update-manager
│   ├── backup/                  # BackupManager (export/restore, local backups)
│   ├── packages/                # PackageManager (GitHub-based plugin distribution)
│   ├── plugins/                 # PluginLoader (integration plugins lifecycle)
│   ├── integrations/            # IntegrationRegistry (runtime registry — plugins register here)
│   ├── recipes/                 # RecipeLoader + engine/recipe-manager.ts
│   ├── devices/                 # Device manager, category inference
│   ├── equipments/              # Equipment manager, bindings, computed engine, order dispatcher
│   ├── zones/                   # Zone manager, zone-aggregator, sunlight-manager
│   ├── modes/                   # Mode manager, calendar manager (croner)
│   ├── energy/                  # Energy aggregator, HP/HC tariff classifier
│   ├── buttons/                 # Button action bindings (Zigbee button → mode/order)
│   ├── charts/                  # Saved chart configurations
│   ├── history/                 # InfluxDB history writer
│   ├── mqtt-publishers/         # Outbound MQTT (broker + publisher managers)
│   ├── notifications/           # Telegram/webhook/FCM/ntfy notification publishers
│   ├── auth/                    # JWT + API tokens, middleware, first-run setup
│   ├── users/                   # User CRUD, preferences
│   ├── api/                     # Fastify server, WebSocket, route files
│   └── shared/                  # types.ts (all interfaces), constants.ts, plugin-api.ts
├── ui/                          # React frontend (separate Vite project)
├── plugins/
│   └── registry.json            # Official plugin registry (fetched remotely with local fallback)
├── migrations/                  # SQLite migration SQL files (runs on startup)
├── specs/XXX-name/              # Per-feature specs (spec.md + architecture.md + plan.md)
├── docs/                        # MkDocs Material — see "Where to find context" above
└── scripts/
    ├── release.sh               # Release script (versioning + tag + push)
    ├── energy/                  # InfluxDB energy backfill, diagnostic
    └── logs/fetch-logs.py       # Log retrieval helper
```

**Not in src/ anymore**: no more built-in integrations or recipes. Each has its own GitHub repo (e.g. `sowel-plugin-zigbee2mqtt`). See `plugins/registry.json` for the current list.

## Build & run commands

```bash
# Backend
npm install
npm run dev                  # Development with tsx watch
npm run build                # tsc build to dist/
npm start                    # Production run

# Frontend
cd ui && npm install
cd ui && npm run dev         # Vite dev server
cd ui && npm run build       # Production build

# Tests
npx vitest run               # All backend tests
npx vitest run <file>        # Single test file

# Type checks and lint
npx tsc --noEmit             # Backend
cd ui && npx tsc -b --noEmit # UI
npx eslint src/ --ext .ts
cd ui && npx eslint .

# Full validate
npm run validate             # Runs all checks (backend + UI)

# Docker
docker compose up -d         # Local docker deployment
```

## Git workflow

- **Feature branches required** for any non-trivial change. Prefixes: `feat/`, `fix/`, `refactor/`, `docs/`.
- Small isolated fixes (typo, single-line) may go on `main` directly.
- **Never merge a PR without explicit user approval**. Present the PR, wait for "oui" / "merge" / "go".
- **Never add `Co-Authored-By: Claude` lines** in commit messages or PR bodies.
- Conventional commits. Scopes: `mqtt`, `devices`, `equipments`, `zones`, `recipes`, `modes`, `api`, `ws`, `ui`, `auth`, `db`, `core`, `plugins`, `packages`, `backup`, `self-update`, `energy`, `logging`.

## Implementation conventions

### IDs and data

- UUID v4 (`crypto.randomUUID()`) for all entity IDs
- ISO 8601 dates everywhere
- All types in `src/shared/types.ts`, discriminated unions for EventBus

### Database

- SQLite via `better-sqlite3` (synchronous — fast, no callback overhead)
- WAL mode (`PRAGMA journal_mode=WAL`)
- Migrations in `migrations/` run on startup (sequential numbering)
- Use transactions for batch writes

### Integrations (plugins)

- Each integration is a **plugin package** distributed from GitHub — see spec 053/054
- `PackageManager` downloads/installs/updates; `PluginLoader` or `RecipeLoader` handles lifecycle
- Plugins export `createPlugin(deps)` returning an `IntegrationPlugin` (see `src/shared/plugin-api.ts`)
- Settings stored in `settings` table under `integration.<id>.<key>`
- All message/event handlers must never throw — wrap in try/catch with structured log
- Missing plugins on disk are **auto-downloaded** on startup (spec 058)

### Event Bus

- Typed `EventEmitter` with TypeScript discriminated union (`EngineEvent`)
- All handlers must be non-blocking and never throw
- High-frequency events are deduplicated per batch before being sent to WebSocket clients

### Authentication

- Passwords: bcrypt cost 12. JWT HS256 via `jsonwebtoken`.
- Access token TTL 15 min, refresh token TTL 30 days
- API tokens: `swl_` prefix, SHA-256 hash stored, `crypto.randomBytes(32)`
- Roles: `admin` > `user` > `viewer`

### Frontend

- Zustand stores per domain, updated by WebSocket events
- Tailwind utility classes only, no custom CSS files
- Mobile-first responsive (breakpoints: 640px, 1024px)
- Dark mode via Tailwind `class` strategy
- Lucide icons, stroke 1.5px

### Logging

- **Always** use pino structured logging, **never** `console.*`
- Child logger per module: `logger.child({ module: "module-name" })`
- Structured context first, message second: `logger.info({ deviceId, status }, "Device status changed")`
- Error logs must include `{ err }`: `logger.error({ err }, "Poll failed")`
- Sensitive fields (password, token, secret, apiKey) are auto-redacted by config

### Log levels

| Level   | When                                                          |
| ------- | ------------------------------------------------------------- |
| `fatal` | Process crash imminent                                        |
| `error` | Operation failed, engine continues                            |
| `warn`  | Self-recovering degradation (reconnect, retry, stale data)    |
| `info`  | Significant business events — one per operation, not per item |
| `debug` | Developer troubleshooting detail                              |
| `trace` | High-volume hot path (off in production)                      |

Production logs go to both stdout (captured by Docker) and `data/logs/sowel-N.log` (daily rotation, 14 days kept). **File logs survive container recreation**, crucial for post-incident investigation.

## Design system

- **Fonts**: Inter (body), JetBrains Mono (values, logs)
- **Primary**: `#1A4F6E` (ocean blue), hover `#13405A`, light `#E6F0F6`
- **Accent**: `#D4963F` (amber), hover `#BB8232`
- **Spacing**: 4px base, 6px radius (buttons), 10px (cards), 14px (modals)
- **Font sizes**: 14px body, 28px data values

## Production context (important for session recovery)

- **Production runs on**: Linux VM `sowelox` (Proxmox), x86_64, 8 GB RAM
- **Path**: `/opt/sowel/`
- **Access**: LAN `http://192.168.0.230:3000`, public `https://app.sowel.org` (Cloudflare tunnel)
- **Related services on the same VM**: mosquitto (MQTT broker), zigbee2mqtt, lora2mqtt, cloudflared — **not** managed by Sowel itself
- **Log files** accessible via `ssh mchacher@192.168.0.230 'docker exec sowel cat /app/data/logs/sowel.N.log'`
- **SSH / API credentials**: in memory file `reference_sowel_access.md`
- **Timezone**: `TZ=Europe/Paris` explicitly set in compose (workaround pending spec 061 auto-derivation)

See [docs/technical/deployment.md](docs/technical/deployment.md) for the full operations guide.

## Skills available

The repo ships Claude Code skills under `.claude/skills/`:

| Skill                | When to use                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `sowel-feature`      | Implementing a new feature (Phase 1-6 workflow with gates). Drafts spec, creates branch, implements, tests, PRs. |
| `debug-bug`          | Investigating a bug. Gathers symptoms, pulls logs, traces the pipeline, presents diagnosis before fix.           |
| `sowel-release`      | Bumping version, tagging, pushing — triggers GitHub Actions build.                                               |
| `plugin-integration` | Creating a new plugin integration (plugin code, UI touchpoints, manifest).                                       |
| `update-docs`        | Updating MkDocs pages when features change.                                                                      |

## Energy monitoring notes

Energy data flows through 3 InfluxDB buckets: `sowel` (raw, 7d) → `sowel-energy-hourly` (2y) → `sowel-energy-daily` (10y). Downsampling tasks are created automatically on startup. Key gotchas documented in [docs/technical/architecture.md](docs/technical/architecture.md#influxdb):

- `aggregateWindow` must use `timeSrc: "_start"` to avoid a +1h offset
- Day boundaries use local midnight (assumes correct TZ — see spec 061)
- HP/HC tariff classifier in `src/energy/tariff-classifier.ts` uses `getHours()` which is TZ-sensitive

## When in doubt

1. **Read `docs/specs-index.md` first** to see if there's already a spec for what you're about to do
2. **Read the relevant architecture section** in `docs/technical/architecture.md`
3. **Grep for similar patterns** in the codebase before inventing
4. **Ask the user** if requirements are unclear — never assume
