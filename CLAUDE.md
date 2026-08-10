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

### Plugin supply chain security (spec 089 — MANDATORY for AI agents)

Every entry in `plugins/registry.json` MUST carry `sha256` (64 hex chars) and `owner` (GitHub login). The install flow refuses any entry missing either field and refuses any tarball whose hash does not match.

**Whenever a plugin release is published, the registry MUST be updated.** Workflow:

1. Plugin author publishes a new GitHub release (tag + `sowel-plugin-<id>-<version>.tar.gz` asset).
2. Run `node scripts/backfill-registry-sha256.mjs` in this repo — the script fetches the latest release asset for every entry and writes the SHA256 in place. Idempotent unless `FORCE=1`.
3. Commit `plugins/registry.json` with a `chore(registry): bump <plugin> to <version>` message.
4. Open a PR. Merge propagates the new hash to all Sowel instances within ~1h (CDN cache).

**Do NOT publish a release without updating the registry hash** — installs of the new version will fail with `ChecksumMismatchError` until the registry catches up.

**Official vs community owners**: `OFFICIAL_OWNERS = ["mchacher"]` in `src/packages/registry-types.ts` is the hard-coded whitelist. Plugins from any other owner are flagged community in the UI and require an explicit user confirmation modal at install. The `OFFICIAL_OWNERS` list grows by review (not by PR — a PR adding to it must be reviewed by the Sowel maintainer).

If the registry CI fails on SHA256 mismatch, the fix is always to re-run `backfill-registry-sha256.mjs`, never to remove the field or bypass the check.

### Release notes are mandatory (spec 108 — MANDATORY for AI agents)

Every Sowel release MUST have a matching entry in **both** `docs/release-notes.md` and `docs/release-notes.fr.md` before the version tag is pushed. The in-app `UpdatesSheet` (spec 107) links to `https://docs.sowel.org/release-notes/#v<x>-<y>-<z>` from the core update row — missing entries break that link.

Workflow when cutting a release (`vX.Y.Z`):

1. Add a `### vX.Y.Z — YYYY-MM-DD { #vX-Y-Z }` block under the matching minor section in **both** `docs/release-notes.md` and `docs/release-notes.fr.md`. The explicit `{ #vX-Y-Z }` anchor is required — without it, MkDocs slugifies the heading into `vXYZ-YYYY-MM-DD` and the in-app link 404s.
2. Stage and commit the docs together with the version bump in `package.json` / `ui/package.json` (single `release: vX.Y.Z` commit).
3. Tag and push as usual via `scripts/release.sh`.

The `verify-release-notes` job in `.github/workflows/release.yml` greps the tagged commit for `{ #vX-Y-Z }` in both files and fails the workflow (before any Docker layer is built) if either is missing. Recovery: add the entries, amend the commit, `git tag -f vX.Y.Z && git push --force origin vX.Y.Z`.

**Do NOT bypass this check** by editing the workflow or skipping the grep — it is the contract that keeps `docs.sowel.org/release-notes` aligned with what is actually shipped.

### Plugin soft isolation (spec 111)

Every integration plugin runs with scoped Proxies on its `PluginDeps`. There is no opt-out: the isolation is unconditional since v1.11.0. The contract is enforced by `src/plugins/scoped-deps.ts`:

- **Settings**: a plugin can only read/write `integration.<own-id>.*`. The exceptions are listed in `GLOBAL_READABLE_KEYS` (currently `home.latitude`, `home.longitude`, `home.timezone`). Reads on foreign keys return `undefined`; writes throw.
- **Events**: a plugin can only emit types in `ALLOWED_EMIT_TYPES` (`system.integration.{connected,disconnected}`, `system.alarm.{raised,resolved}`). Events with a mismatched `integrationId` are dropped.
- **Devices**: every `DeviceManager` mutation (`updateDeviceData`, `upsertFromDiscovery`, etc.) checks `integrationId === pluginId`. Admin methods (`update`, `delete`) throw for plugins.
- **Errors**: `wrapPluginMethods` swallows throws from `refresh`, `getStatus`, etc. (degraded fallback) and rethrows from `start`, `stop`, `executeOrder`, `handleOAuthCallback` (callers need the error).

When reviewing a plugin PR or adding a new event type/global setting, **extend the allowlists in `scoped-deps.ts` rather than weakening the gates**. Every denial logs `"Plugin denied …"` with `pluginId` context — that line is the audit trail.

The Proxy does NOT protect against direct `require("better-sqlite3")`, `process.env` reads, infinite loops, prototype pollution, arbitrary `fetch`, or `process.exit`. Those would require worker_thread isolation (spec 111b, hypothetical).

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

Production logs go to both stdout (captured by Docker) and `data/logs/sowel.<yyyy-MM-dd>.N.log` (daily rotation, 14 days kept, one predictable file per calendar day). **File logs survive container recreation**, crucial for post-incident investigation.

## Design system

- **Fonts**: Inter (body), JetBrains Mono (values, logs)
- **Primary**: `#1A4F6E` (ocean blue), hover `#13405A`, light `#E6F0F6`
- **Accent**: `#D4963F` (amber), hover `#BB8232`
- **Spacing**: 4px base, 6px radius (buttons), 10px (cards), 14px (modals)
- **Font sizes**: 14px body, 28px data values

## Installation-specific context (private companion repo)

This public repo contains **nothing specific to a given installation** (no hosts, no IPs, no SSH targets, no credentials). That context lives in a private companion repo cloned as a sibling directory, by convention named `sowel-ops`:

```
<parent-dir>/
├── sowel/          # this repo (any clone name works)
└── sowel-ops/      # private: your hosts, SSH targets, agent context
```

Two integration points:

1. `CLAUDE.md` imports the private agent context below. If the file is absent, the import is skipped and everything else works.
2. `scripts/run-swap.sh` and `scripts/shadow-deploy.sh` source `../sowel-ops/ops.env` (see `scripts/ops.env.example`) for remote hosts. Without it, remote operations refuse with a clear error; local-only usage needs nothing.

**Contributors**: to use the ops scripts or give AI agents context about your own deployment, create your own private `sowel-ops` repo with a `CLAUDE.ops.md` and an `ops.env` (start from `scripts/ops.env.example`). Never put installation details in this repo.

@../sowel-ops/CLAUDE.ops.md

See [docs/technical/deployment.md](docs/technical/deployment.md) for the generic operations guide.

## Skills available

The repo ships Claude Code skills under `.claude/skills/`:

| Skill              | When to use                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `sowel-feature`    | Implementing a new feature (Phase 1-6 workflow with gates). Drafts spec, creates branch, implements, tests, PRs.                       |
| `sowel-debug`      | Investigating a bug. Gathers symptoms, pulls logs, traces the pipeline, presents diagnosis before fix.                                 |
| `sowel-release`    | Bumping version, tagging, pushing — triggers GitHub Actions build.                                                                     |
| `sowel-plugin-dev` | Creating a new plugin integration (plugin code, UI touchpoints, manifest).                                                             |
| `sowel-recipe-dev` | Developing a personal recipe as an external package: scaffold, createRecipe factory, release, personal-source install loop (spec 136). |
| `sowel-docs`       | Updating MkDocs pages when features change.                                                                                            |
| `sowel-issue`      | Handling a GitHub issue end-to-end: qualify, rewrite, implement, PR, close on merge.                                                   |

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
