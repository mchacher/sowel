# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Winch** is a home automation engine with a plugin-based integration architecture. It supports multiple device sources (Zigbee2MQTT, Panasonic Comfort Cloud, MCZ Maestro, and more via the IntegrationPlugin interface). It separates physical **Devices** (auto-discovered from integrations) from user-facing **Equipments** (functional units like "Spots Salon"), provides automatic **Zone** aggregation, a **Scenario** engine with reusable **Recipe** templates, and exposes a reactive web UI.

The full specification is in [winch-spec.md](winch-spec.md) — it is the single source of truth. It is a living document that evolves alongside feature development; always re-read the relevant sections before implementing a milestone.

## Architecture

### Reactive Pipeline (core data flow)

```
Integration message (MQTT, cloud API poll, etc.)
  → Integration Plugin (receives + parses)
    → Device Manager (updates DeviceData)
      → Event Bus: "device.data.updated"
        → Equipment Manager (re-evaluates bindings + computed Data)
          → Event Bus: "equipment.data.changed"
            → Zone Manager (re-evaluates aggregations)
              → Event Bus: "zone.data.changed"
                → Scenario Engine (evaluates triggers → conditions → actions)
                  → Actions may emit Orders → Integration Plugin → device
            → WebSocket pushes to UI clients
```

### Key Domain Concepts

| Term          | Role                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| **Device**    | Physical hardware, auto-discovered from integrations. Exposes raw Data and Orders.                              |
| **Equipment** | User-facing functional unit. Binds to one or more Devices. Can have computed Data and dispatched Orders.        |
| **Zone**      | Spatial grouping (nestable). Auto-aggregates Equipment Data (motion=OR, temperature=AVG, lightsOn=COUNT, etc.). |
| **Scenario**  | Automation rule: trigger(s) → condition(s) → action(s).                                                         |
| **Recipe**    | Reusable Scenario template with typed parameter slots.                                                          |

### Tech Stack

**Backend:** Node.js 20+ / TypeScript (strict) / Fastify / SQLite (better-sqlite3) / InfluxDB 2.x / ws (WebSocket) / mqtt.js (for MQTT integrations)

**Frontend:** React 18+ / TypeScript / Vite / Tailwind CSS / Zustand / Lucide React

**Infrastructure:** Docker + docker-compose / PM2

### Project Structure

```
winch/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config.ts                # Env config loading
│   ├── core/                    # event-bus, database (SQLite), influx, logger
│   ├── integrations/            # Integration plugins (zigbee2mqtt, panasonic-cc, mcz-maestro, ...)
│   ├── devices/                 # Device manager, auto-discovery, category inference
│   ├── equipments/              # Equipment manager, bindings, computed engine, order dispatcher
│   ├── zones/                   # Zone manager, auto-aggregation engine
│   ├── scenarios/               # Scenario engine, triggers, conditions, actions, recipes
│   ├── ai/                      # LLM integration (Claude/OpenAI/Ollama) — V1.0+
│   ├── auth/                    # JWT + API tokens, middleware, first-run setup
│   ├── users/                   # User CRUD, preferences
│   ├── notifications/           # Channels: telegram, webhook, FCM, ntfy, email
│   ├── api/                     # Fastify server, WebSocket handler, route files
│   └── shared/                  # types.ts (all interfaces), constants.ts
├── ui/                          # React frontend (separate Vite project)
│   └── src/
│       ├── store/               # Zustand stores (devices, equipments, zones, WebSocket)
│       ├── components/          # By domain: dashboard/, devices/, equipments/, zones/, scenarios/
│       └── pages/               # Dashboard, Devices, Equipments, Zones, Scenarios, Settings
├── recipes/                     # Built-in Recipe JSON templates
└── migrations/                  # SQLite migration SQL files
```

## Build & Run Commands

```bash
# Backend
npm install
npm run dev          # Development with hot reload
npm run build        # TypeScript compilation
npm start            # Production (compiled JS)

# Frontend (from ui/ directory)
cd ui && npm install
cd ui && npm run dev     # Vite dev server
cd ui && npm run build   # Production build

# Docker
docker-compose up -d     # Engine + InfluxDB

# Tests
npm test                 # Run all tests
npm test -- --grep "pattern"  # Run specific tests
```

## Git Workflow

- **Feature branches required**: any non-trivial development (new feature, refactoring, multi-file changes) must be done on a dedicated branch, not directly on `main`. Use descriptive branch names like `feat/gate-abstraction` or `fix/rate-limit`.
- Small, isolated fixes (typo, single-line config change) may go directly on `main`.

## Implementation Conventions

### IDs and Data

- UUID v4 for all entity IDs (`crypto.randomUUID()`)
- All dates in ISO 8601 format
- All types defined in `src/shared/types.ts`, shared across backend modules
- Use TypeScript discriminated unions for the typed Event Bus

### Database

- SQLite via `better-sqlite3` synchronous API — intentionally sync, very fast
- WAL mode: `PRAGMA journal_mode=WAL`
- Run migrations on startup
- Use transactions for batch operations

### Integrations

- Plugin-based architecture: each device source implements `IntegrationPlugin`
- Plugins register with `IntegrationRegistry` which manages lifecycle (start/stop/reconnect)
- MQTT-based integrations use `mqtt.js` with `connectAsync` for async/await
- Cloud-based integrations use polling with configurable intervals
- All message/event handlers must never throw — wrap in try/catch with logging
- Settings stored in SQLite `settings` table, configurable from UI

### Event Bus

- Typed EventEmitter with TypeScript discriminated union (`EngineEvent` type)
- All handlers must be non-blocking and never throw

### Expression Engine

- Safe expression parser (NOT `eval`) — consider `expr-eval` or custom
- References: `binding.<alias>`, `equipment.<id>.<key>`, `zone.<zoneId>.<key>`
- Operators: OR, AND, NOT, AVG, MIN, MAX, SUM, IF, THRESHOLD

### Authentication

- bcrypt (cost 12) for passwords, `jsonwebtoken` (HS256) for JWT
- API tokens: `wch_` prefix (legacy `cbl_` also accepted), SHA-256 hash stored, generated via `crypto.randomBytes(32)`
- Auth middleware: try JWT decode first, then API token lookup
- Roles: admin > user > viewer (hierarchical permissions)

### Frontend

- Zustand stores updated by WebSocket events
- Auto-reconnecting WebSocket with state recovery (incremental or full)
- Tailwind CSS utility classes only — no custom CSS files
- Mobile-first responsive design (breakpoints: 640px, 1024px)

### Logging

Structured JSON logging via pino (Fastify default) with multistream: ring buffer (UI), pino-pretty (dev), JSON stdout + pino-roll files (prod).

#### Log Level Strategy

| Level     | Purpose                                             | Production visible | Examples                                                                     |
| --------- | --------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| **fatal** | Process about to crash, unrecoverable               | Yes                | Uncaught exception, database corruption                                      |
| **error** | Operation failed, engine continues. Needs attention | Yes                | Integration poll failed, order dispatch error, recipe execution error        |
| **warn**  | Unexpected situation, handled gracefully            | Yes                | MQTT reconnecting, device offline, token refresh retry, stale device cleanup |
| **info**  | Significant business events — one per operation     | Yes                | Engine start/stop, device discovered/removed, equipment CRUD, mode activated |
| **debug** | Operational detail for troubleshooting              | No (dev/UI only)   | Binding evaluation, aggregation steps, migration applied, config loaded      |
| **trace** | High-volume hot-path data, deep debugging only      | No (dev/UI only)   | Every event bus emission, every MQTT message, every data point update        |

#### Level Assignment Rules

- **info = admin dashboard**: an operator reading info logs should understand _what happened_ without drowning. One log per business operation, not per item processed.
- **debug = developer session**: detailed enough to trace a specific problem. One human can read these for a module during a debug session.
- **trace = replay mode**: enables reproducing exact state transitions. High volume, never on in production.
- **error always includes `{ err }`**: pass the Error object as structured context, e.g. `logger.error({ err }, "Poll failed")`.
- **warn = self-recovering**: the system handled it, but repeated warnings signal degradation.
- **Never use `console.log/error/warn`**: always use the structured pino logger. Console calls bypass the ring buffer, file rotation, and redaction.

#### What Goes Where (by domain)

| Domain           | info                                        | debug                                    | trace                       |
| ---------------- | ------------------------------------------- | ---------------------------------------- | --------------------------- |
| **MQTT**         | Connected, disconnected, reconnecting       | Subscribed to topic, publish result      | Every message received      |
| **Devices**      | Discovered, removed, status changed         | Data auto-created, category inferred     | Every data point update     |
| **Equipments**   | CRUD, order dispatched                      | Binding evaluation, computed data result | Every binding re-evaluation |
| **Zones**        | CRUD, aggregation summary                   | Individual aggregation fields computed   | Every aggregation trigger   |
| **Modes**        | Activated, deactivated, CRUD                | Each impact action executed              | —                           |
| **Recipes**      | Instance created/deleted, enabled/disabled  | Execution steps, trigger evaluation      | —                           |
| **Integrations** | Started, stopped, connected, poll completed | Poll cycle details, API call results     | Raw API responses           |
| **Auth**         | User login, token created, password changed | JWT validation, middleware decisions     | —                           |
| **API**          | Server listening, route registered          | Request handling details                 | Every request/response      |
| **WebSocket**    | Client connected/disconnected               | Topic subscription, message sent         | Every frame                 |
| **Event Bus**    | —                                           | —                                        | Every event emitted         |
| **Database**     | DB opened, migration applied                | Query execution, schema changes          | —                           |

#### Logger Conventions

- **Property name**: use `this.logger` in classes, `logger` in standalone functions. Never `this.log`, `log`, or `console`.
- **Child loggers**: every module creates a child logger with `{ module: "module-name" }` for filtering.
- **Structured context**: pass data as first argument object, message as second: `logger.info({ deviceId, status }, "Device status changed")`.
- **Sensitive data**: automatically redacted by pino config (passwords, tokens, secrets, API keys). Never log credentials manually.
- **No string interpolation in messages**: use `logger.info({ count }, "Devices discovered")` not `logger.info("Discovered ${count} devices")`.

## Design System

- **Font:** Inter (body), JetBrains Mono (values/logs)
- **Primary color:** `#1A4F6E` (ocean blue) — hover: `#13405A`, light: `#E6F0F6`
- **Accent color:** `#D4963F` (amber) — hover: `#BB8232`
- **Spacing base unit:** 4px
- **Border radius:** 6px (buttons), 10px (cards), 14px (modals)
- **Body font size:** 14px (dense dashboard), Data values: 28px (readable at a glance)
- **Icons:** Lucide React, stroke 1.5px
- Dark mode via Tailwind `class` strategy — essential for nighttime dashboard use

## Development Roadmap

V0.1 Devices → V0.2 Zones → V0.3 Equipments+Bindings → V0.4 UI Home → V0.5 Sensors → V0.6 Zone Aggregation → V0.7 Shutters → V0.8 Recipes → V0.9 Modes+Calendar → V0.10 Integration Plugins (Z2M, Panasonic CC, MCZ Maestro, Netatmo HC) → V0.11 Logging → V0.12 Computed Data → V0.13 History (InfluxDB) → V1.0+ AI Assistant

## Environment Variables

All settings are optional with sensible defaults — Winch runs zero-config out of the box. Override via `.env` if needed:

| Variable          | Default           | Notes                                           |
| ----------------- | ----------------- | ----------------------------------------------- |
| `SQLITE_PATH`     | `./data/winch.db` | SQLite database path                            |
| `API_PORT`        | `3000`            | HTTP server port                                |
| `API_HOST`        | `0.0.0.0`         | Bind address                                    |
| `JWT_SECRET`      | auto-generated    | Persisted in `data/.jwt-secret` on first launch |
| `JWT_ACCESS_TTL`  | `900`             | Access token TTL in seconds (15 min)            |
| `JWT_REFRESH_TTL` | `2592000`         | Refresh token TTL in seconds (30 days)          |
| `LOG_LEVEL`       | `info`            | Pino log level                                  |
| `CORS_ORIGINS`    | `*`               | Comma-separated allowed origins                 |

Integration settings (MQTT, cloud credentials, polling intervals) are configured from the UI (Administration > Integrations), not from `.env`.
