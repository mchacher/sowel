# CLAUDE.md

Guidance for Claude Code (and any AI agent) working on the Sowel repository. This is the **first file to read** when starting a session. It is intentionally short — deep context lives in `docs/` and `specs/`.

## Where to find context

| You want to know...                                                | Read this                                                                                                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| What Sowel is and how it's architected                             | [docs/technical/architecture.md](docs/technical/architecture.md)                                                                         |
| The full list of features ever shipped, by spec                    | [docs/specs-index.md](docs/specs-index.md)                                                                                               |
| How to deploy, update, backup, restore, troubleshoot in production | [docs/technical/deployment.md](docs/technical/deployment.md)                                                                             |
| Data model — tables, types, events                                 | [docs/technical/data-model.md](docs/technical/data-model.md)                                                                             |
| REST API and WebSocket events                                      | [docs/technical/api-reference.md](docs/technical/api-reference.md)                                                                       |
| How to develop a plugin                                            | [docs/technical/plugin-development.md](docs/technical/plugin-development.md)                                                             |
| How to develop a recipe                                            | [docs/technical/recipe-development.md](docs/technical/recipe-development.md)                                                             |
| Specific feature history / design                                  | `specs/XXX-name/{spec,architecture,plan}.md` — index in `docs/specs-index.md`                                                            |
| The public demonstrator (separate project, 3 repos)                | [sowel-showroom `docs/project-map.md`](https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md) — see the section below |

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

- **Backend**: Node.js 24+, TypeScript strict, Fastify, SQLite (better-sqlite3), InfluxDB 2.x, ws, mqtt.js, pino
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS 4 (config-less), Zustand, Lucide React
- **Infra**: Docker + docker-compose, GitHub Actions release to ghcr.io

## Project structure

Full tree and the role of each folder: [docs/technical/architecture.md](docs/technical/architecture.md#project-structure). In short: backend in `src/` (one folder per domain, all interfaces in `src/shared/types.ts`), React UI in `ui/` (separate Vite project), SQLite migrations in `migrations/`, specs in `specs/NNN-name/`, MkDocs in `docs/`, scripts in `scripts/`.

**No built-in integration or recipe** (spec 053): each has its own GitHub repo (e.g. `sowel-plugin-zigbee2mqtt`); the official list is `plugins/registry.json`.

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
npx tsc --noEmit             # Backend (src only — tests are excluded)
npm run typecheck:tests      # Backend INCLUDING test files (#834, gated in CI)
cd ui && npx tsc -b --noEmit # UI (its tests are already covered)
npx eslint src/ --ext .ts
cd ui && npx eslint .

# Full validate — THE verdict, the CI set in one command (also run by the husky pre-push hook)
npm run validate

# Docker
docker compose up -d         # Local docker deployment
```

## Git workflow

- **Feature branches required** for any non-trivial change. Prefixes: `feat/`, `fix/`, `refactor/`, `docs/`.
- Small isolated fixes (typo, single-line) may go on `main` directly.
- **Never merge a PR without explicit user approval**. Present the PR, wait for "oui" / "merge" / "go". Main is protected (PR required, linear history): merge with `gh pr merge --squash` once the checks are green.
- **Never add `Co-Authored-By: Claude` lines** in commit messages or PR bodies.
- Conventional commits. Scopes: `mqtt`, `devices`, `equipments`, `zones`, `recipes`, `modes`, `api`, `ws`, `ui`, `auth`, `db`, `core`, `plugins`, `packages`, `backup`, `self-update`, `energy`, `logging`, `docs`, `registry`.

## Implementation conventions

### IDs and data

- UUID v4 (`crypto.randomUUID()`) for all entity IDs
- ISO 8601 dates everywhere
- All types in `src/shared/types.ts`, discriminated unions for EventBus
- **Relative imports in `src/` carry an explicit `.js`** (`"./foo.js"`, never `"./foo"`), including `import type`. The backend is `"type": "module"` and runs `node dist/index.js`, so Node ESM demands it — but `moduleResolution: "bundler"` lets `tsc` accept it without, and vitest resolves it too, so a missing extension compiles, lints, passes the whole suite and then throws `ERR_MODULE_NOT_FOUND` at startup. An eslint `no-restricted-syntax` rule blocks it now. The UI is bundled by Vite and is not subject to this.

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

### Plugin registry (spec 089 — MANDATORY for AI agents)

Every `plugins/registry.json` entry carries `sha256` and `owner`; installs refuse anything else. A plugin release is always followed by `node scripts/backfill-registry-sha256.mjs` and a `chore(registry): bump <plugin> to <version>` PR, checked by `bash scripts/check-registry-bump.sh` (locally and in CI). A hash mismatch is fixed by re-running the backfill, **never** by removing the field or bypassing the check. `OFFICIAL_OWNERS` (`src/packages/registry-types.ts`) changes only through the maintainer. Procedure: the `sowel-plugin-dev` skill.

### Release notes (spec 108 — MANDATORY for AI agents)

Every release has a `### vX.Y.Z — YYYY-MM-DD { #vX-Y-Z }` entry in **both** `docs/release-notes.md` and `docs/release-notes.fr.md` before the tag: the in-app UpdatesSheet links to that anchor, and the `verify-release-notes` job fails the release without it. Do NOT bypass it. Procedure: the `sowel-release` skill.

### Documentation currency (spec 167 — MANDATORY for AI agents)

Three checks run on every pull request; run them locally before pushing:

```bash
bash scripts/check-docs-parity.sh        # EN/FR pairs (x.md / x.fr.md) change together
bash scripts/check-docs-impact.sh        # a feat/fix touching src/ or ui/src/ changes docs/
bash scripts/check-specs-index.sh folders  # every specs/NNN-*/ has a row in both specs indexes
```

Waivers are PR-body lines, and **the reason is required** (a bare `none` fails on purpose):

```
Docs-Impact: none — <why nothing a reader can observe changed>
Docs-Parity: docs/technical/api-reference.fr.md — typo fix in the EN copy only
```

The specs index has no waiver. `scripts/docs-impact-map.sh` prints the pages a change probably affects; when you find drift it misses, add a row. Why: the 2026-08-29 audit (`docs/audit/2026-08-29-documentation.md`) found three months of drift where nothing was gated, and none at all in the release notes, which are. Do not weaken these checks: update the page, or write the sentence. Details: `specs/167-documentation-currency/`.

### Plugin soft isolation (spec 111)

Every integration plugin runs with scoped Proxies on its `PluginDeps` (`src/plugins/scoped-deps.ts`, unconditional): it reads and writes only `integration.<own-id>.*` settings (plus `GLOBAL_READABLE_KEYS`), emits only `ALLOWED_EMIT_TYPES`, and mutates only its own devices. **Extend the allowlists, never weaken the gates.** Every denial logs `"Plugin denied …"`. It is not a sandbox (no protection against `require`, `process.env`, `fetch`, loops). Details: `specs/111-plugin-soft-isolation/`.

### Event Bus

- Typed `EventEmitter` with TypeScript discriminated union (`EngineEvent`)
- All handlers must be non-blocking and never throw
- High-frequency events are deduplicated per batch before being sent to WebSocket clients

### Authentication

- Roles: `admin` > `standard` (`UserRole` in `src/shared/types.ts`). Passwords, JWT, API tokens, MFA: [architecture.md](docs/technical/architecture.md) (Authentication).

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

### Log levels and files

`fatal` crash imminent, `error` operation failed, `warn` self-recovering degradation, `info` one per business operation, `debug` troubleshooting, `trace` hot path (off in production). Guidance and log file location (`data/logs/`, daily rotation, kept 14 days): [architecture.md](docs/technical/architecture.md) (Logging).

## Design system

- **Fonts**: Inter (body), JetBrains Mono (values, logs)
- **Primary**: `#1A4F6E` (ocean blue), hover `#144159`, light `#EEF5F8`
- **Accent**: `#F2C035` (amber), hover `#D4A41C`
- **Spacing**: 4px base; radii 6px / 8px / 12px (`--radius-sm/md/lg`)
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

## Public demonstrator (separate project, three repos)

A public demo of Sowel — a fictional house that lives in real time, that anyone can visit and act on — is being built as a **project separate from this repository**. Nothing of it lands here: the showroom runs the published `ghcr.io/mchacher/sowel` image, unmodified.

| Repository                                                                     | Nature         | Role                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`sowel-plugin-simulator`](https://github.com/mchacher/sowel-plugin-simulator) | Sowel plugin   | Simulates the physical world (occupants on an agenda, sun, weather, thermal, PV and loads) and publishes it as ordinary devices — occupants included. Sowel's own recipes do the automation on top. |
| [`sowel-house-3d`](https://github.com/mchacher/sowel-house-3d)                 | Application    | A stylised 3D view of a home, driven live by any Sowel instance over the public API and WebSocket. Generic; the showroom is one deployment.                                                         |
| [`sowel-showroom`](https://github.com/mchacher/sowel-showroom)                 | Infrastructure | Compose stack, reverse proxy (guest login, deny list, quotas), nightly reset, demo fixture, and **the project map**.                                                                                |

**Read the project map first** for anything demo-related: <https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md>. It carries the decisions taken (pure simulator, no production mirror; visitors can act; one shared world; nightly reset keeping InfluxDB; real time), the alternatives already rejected, the contract between the three pieces, and the seven-phase plan with its cross-repository status. Those decisions are not reopened by a phase spec without an explicit amendment there.

**What this means for work in this repository.** Anything the demo needs that the product does not offer is done in the plugin, the proxy or the 3D app — or becomes an ordinary product issue, argued on its own merits, never as "the demo needs it". The one such issue so far is [#912](https://github.com/mchacher/sowel/issues/912) (a `standard` user may activate a mode), which is a fair product improvement in its own right.

The three repositories are expected as sibling directories, like `sowel-ops`:

```
<parent-dir>/
├── sowel/                    # this repo
├── sowel-ops/                # private ops context
├── sowel-showroom/           # demo infrastructure + project map
├── sowel-plugin-simulator/   # the simulated house
└── sowel-house-3d/           # the 3D view
```

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

And one agent under `.claude/agents/`: **`sowel-reviewer`**, the read-only review of a branch diff before its PR, called by `sowel-feature`, `sowel-issue` and `sowel-debug`. It holds the review checklist.

## Energy monitoring notes

Energy data flows through 3 InfluxDB buckets: `sowel` (raw, 7d) → `sowel-energy-hourly` (2y) → `sowel-energy-daily` (10y). Downsampling tasks are created automatically on startup. Key gotchas documented in [docs/technical/architecture.md](docs/technical/architecture.md#influxdb):

- `aggregateWindow` must use `timeSrc: "_start"` to avoid a +1h offset
- Day boundaries use local midnight (assumes correct TZ — see spec 061)
- HP/HC tariff classifier in `src/energy/tariff-classifier.ts` uses `getHours()` which is TZ-sensitive

## Answering the user

Keep answers short and ordered. One or two lines for the what, then one short bullet per finding,
problem or decision. No preamble, no restating the question, no narrating the work in progress.
Long prose belongs in the spec, the PR body or the release notes, never in the terminal.

## When in doubt

1. **Read `docs/specs-index.md` first** to see if there's already a spec for what you're about to do
2. **Read the relevant architecture section** in `docs/technical/architecture.md`
3. **Grep for similar patterns** in the codebase before inventing
4. **Ask the user** if requirements are unclear — never assume
