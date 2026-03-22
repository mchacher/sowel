# Contributing to Sowel

This guide covers everything a contributor needs to know to set up the development environment, follow the project conventions, and submit changes.

---

## Development Setup

### Prerequisites

- **Node.js 20+**
- **npm** (comes with Node.js)
- **Docker + docker-compose** (for InfluxDB)
- **Git**

### Backend

```bash
git clone <repo-url>
cd sowel
npm install
npm run dev          # Development with hot reload (ts-node + nodemon)
```

### Frontend

```bash
cd ui
npm install
npm run dev          # Vite dev server (hot module replacement)
```

### Docker (InfluxDB)

```bash
docker-compose up -d     # Starts InfluxDB 2.x
```

InfluxDB is mandatory -- Sowel connects on startup and auto-creates buckets, downsampling tasks, and energy aggregation tasks. No manual setup needed.

### Build

```bash
# Backend: TypeScript compilation
npm run build

# Frontend: production build
cd ui && npm run build

# Start production
npm start
```

### Tests

```bash
npm test                          # Run all tests
npm test -- --grep "pattern"      # Run specific tests
```

Tests use Vitest with in-memory SQLite databases and fake timers.

---

## Git Workflow

### Branch Strategy

- **Feature branches required**: any non-trivial development (new feature, refactoring, multi-file changes) must be done on a dedicated branch, not directly on `main`.
- Use descriptive branch names: `feat/gate-abstraction`, `fix/rate-limit`, `refactor/influxdb-mandatory-core`.
- Small, isolated fixes (typo, single-line config change) may go directly on `main`.

### Pull Requests

- **PR merge requires explicit user approval**: never merge a pull request without the maintainer's explicit validation.
- Create the PR, present it, and wait for approval before merging.
- Keep PRs focused -- one feature or fix per PR.

### Commit Messages

Follow conventional commit style:

```
feat(devices): add auto-discovery for Netatmo HC
fix(energy): correct HP/HC timestamp offset
refactor(core): make InfluxDB mandatory
docs(api): update endpoint documentation
```

---

## Coding Conventions

### TypeScript

- **Strict mode** is enabled project-wide.
- All types are defined in `src/shared/types.ts` and shared across backend modules.
- Use TypeScript discriminated unions for the typed Event Bus (`EngineEvent` type).
- Always run `npx tsc --noEmit` before committing to catch type errors.

### IDs and Data

- UUID v4 for all entity IDs: `crypto.randomUUID()`.
- All dates in ISO 8601 format.
- All interfaces live in `src/shared/types.ts`.

### Database

- SQLite via `better-sqlite3` synchronous API -- intentionally sync, very fast.
- WAL mode: `PRAGMA journal_mode=WAL`.
- Migrations in `migrations/` directory, run automatically on startup.
- Use transactions for batch operations.
- Migration files follow the naming pattern: `NNN_description.sql` (e.g. `033_plugins.sql`).

### Event Bus

- Typed `EventEmitter` with TypeScript discriminated union (`EngineEvent` type).
- All handlers must be **non-blocking** and must **never throw**.
- Wrap all handler logic in try/catch with logging.

### Integrations

- Each device source implements the `IntegrationPlugin` interface.
- Plugins register with `IntegrationRegistry` which manages lifecycle (start/stop/reconnect).
- MQTT-based integrations use `mqtt.js` with `connectAsync` for async/await.
- Cloud-based integrations use polling with configurable intervals.
- All message/event handlers must never throw -- wrap in try/catch with logging.
- Settings stored in SQLite `settings` table under `integration.<id>.<key>`, configurable from the UI.

### Authentication

- bcrypt (cost 12) for passwords, `jsonwebtoken` (HS256) for JWT.
- API tokens: `swl_` prefix, SHA-256 hash stored, generated via `crypto.randomBytes(32)`.
- Auth middleware: try JWT decode first, then API token lookup.
- Roles: `admin` > `standard` > `viewer` (hierarchical permissions).

### Expression Engine

- Safe expression parser (NOT `eval`) -- consider `expr-eval` or custom.
- References: `binding.<alias>`, `equipment.<id>.<key>`, `zone.<zoneId>.<key>`.
- Operators: `OR`, `AND`, `NOT`, `AVG`, `MIN`, `MAX`, `SUM`, `IF`, `THRESHOLD`.

### Frontend

- **Zustand** stores updated by WebSocket events.
- Auto-reconnecting WebSocket with state recovery (incremental or full).
- **Tailwind CSS utility classes only** -- no custom CSS files.
- **Mobile-first** responsive design (breakpoints: 640px, 1024px).
- **Dark mode** via Tailwind `class` strategy.
- **Icons**: Lucide React, stroke 1.5px.

---

## Logging Rules

Structured JSON logging via pino (Fastify default) with multistream: ring buffer (UI), pino-pretty (dev), JSON stdout + pino-roll files (prod).

### Log Levels

| Level     | Purpose                                             | Production visible | Examples                                                                     |
| --------- | --------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| **fatal** | Process about to crash, unrecoverable               | Yes                | Uncaught exception, database corruption                                      |
| **error** | Operation failed, engine continues. Needs attention | Yes                | Integration poll failed, order dispatch error, recipe execution error        |
| **warn**  | Unexpected situation, handled gracefully            | Yes                | MQTT reconnecting, device offline, token refresh retry, stale device cleanup |
| **info**  | Significant business events -- one per operation    | Yes                | Engine start/stop, device discovered/removed, equipment CRUD, mode activated |
| **debug** | Operational detail for troubleshooting              | No (dev/UI only)   | Binding evaluation, aggregation steps, migration applied, config loaded      |
| **trace** | High-volume hot-path data, deep debugging only      | No (dev/UI only)   | Every event bus emission, every MQTT message, every data point update        |

### Level Assignment Rules

- **info = admin dashboard**: an operator reading info logs should understand _what happened_ without drowning. One log per business operation, not per item processed.
- **debug = developer session**: detailed enough to trace a specific problem. One human can read these for a module during a debug session.
- **trace = replay mode**: enables reproducing exact state transitions. High volume, never on in production.
- **error always includes `{ err }`**: pass the Error object as structured context, e.g. `logger.error({ err }, "Poll failed")`.
- **warn = self-recovering**: the system handled it, but repeated warnings signal degradation.
- **Never use `console.log/error/warn`**: always use the structured pino logger. Console calls bypass the ring buffer, file rotation, and redaction.

### What Goes Where (by domain)

| Domain           | info                                        | debug                                    | trace                       |
| ---------------- | ------------------------------------------- | ---------------------------------------- | --------------------------- |
| **MQTT**         | Connected, disconnected, reconnecting       | Subscribed to topic, publish result      | Every message received      |
| **Devices**      | Discovered, removed, status changed         | Data auto-created, category inferred     | Every data point update     |
| **Equipments**   | CRUD, order dispatched                      | Binding evaluation, computed data result | Every binding re-evaluation |
| **Zones**        | CRUD, aggregation summary                   | Individual aggregation fields computed   | Every aggregation trigger   |
| **Modes**        | Activated, deactivated, CRUD                | Each impact action executed              | --                          |
| **Recipes**      | Instance created/deleted, enabled/disabled  | Execution steps, trigger evaluation      | --                          |
| **Integrations** | Started, stopped, connected, poll completed | Poll cycle details, API call results     | Raw API responses           |
| **Auth**         | User login, token created, password changed | JWT validation, middleware decisions     | --                          |
| **API**          | Server listening, route registered          | Request handling details                 | Every request/response      |
| **WebSocket**    | Client connected/disconnected               | Topic subscription, message sent         | Every frame                 |
| **Event Bus**    | --                                          | --                                       | Every event emitted         |
| **Database**     | DB opened, migration applied                | Query execution, schema changes          | --                          |

### Logger Conventions

- **Property name**: use `this.logger` in classes, `logger` in standalone functions. Never `this.log`, `log`, or `console`.
- **Child loggers**: every module creates a child logger with `{ module: "module-name" }` for filtering.
- **Structured context**: pass data as first argument object, message as second: `logger.info({ deviceId, status }, "Device status changed")`.
- **Sensitive data**: automatically redacted by pino config (passwords, tokens, secrets, API keys). Never log credentials manually.
- **No string interpolation in messages**: use `logger.info({ count }, "Devices discovered")` not ``logger.info(`Discovered ${count} devices`)``.

---

## Design System Reference

When adding or modifying UI components, follow these design tokens:

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

## Environment Variables

All settings are optional with sensible defaults -- Sowel runs zero-config out of the box. Override via `.env` if needed:

| Variable          | Default                 | Notes                                             |
| ----------------- | ----------------------- | ------------------------------------------------- |
| `SQLITE_PATH`     | `./data/sowel.db`       | SQLite database path                              |
| `API_PORT`        | `3000`                  | HTTP server port                                  |
| `API_HOST`        | `0.0.0.0`               | Bind address                                      |
| `JWT_SECRET`      | auto-generated          | Persisted in `data/.jwt-secret` on first launch   |
| `JWT_ACCESS_TTL`  | `900`                   | Access token TTL in seconds (15 min)              |
| `JWT_REFRESH_TTL` | `2592000`               | Refresh token TTL in seconds (30 days)            |
| `LOG_LEVEL`       | `info`                  | Pino log level                                    |
| `CORS_ORIGINS`    | `*`                     | Comma-separated allowed origins                   |
| `INFLUX_URL`      | `http://localhost:8086` | InfluxDB 2.x URL                                  |
| `INFLUX_TOKEN`    | auto-generated          | Persisted in `data/.influx-token` on first launch |
| `INFLUX_ORG`      | `sowel`                 | InfluxDB organization                             |
| `INFLUX_BUCKET`   | `sowel`                 | InfluxDB primary bucket                           |

Integration settings (MQTT, cloud credentials, polling intervals) are configured from the UI (Administration > Integrations), not from `.env`.

---

## Project Structure

For a complete project structure diagram and architecture details, see [Architecture Overview](architecture.md).

---

## Development Roadmap

V0.1 Devices -> V0.2 Zones -> V0.3 Equipments+Bindings -> V0.4 UI Home -> V0.5 Sensors -> V0.6 Zone Aggregation -> V0.7 Shutters -> V0.8 Recipes -> V0.9 Modes+Calendar -> V0.10 Integration Plugins (Z2M, Panasonic CC, MCZ Maestro, Netatmo HC) -> V0.11 Logging -> V0.12 Computed Data -> V0.13 History (InfluxDB) -> V1.0+ AI Assistant

---

## Checklist Before Submitting

- [ ] `npx tsc --noEmit` passes (backend)
- [ ] `cd ui && npx tsc --noEmit` passes (frontend, if modified)
- [ ] `npm test` passes
- [ ] No `console.log` calls -- use pino logger
- [ ] Structured logging with proper levels (see rules above)
- [ ] Migrations added if schema changes
- [ ] Feature branch with descriptive name
- [ ] PR description explains the "why"
