# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Corbel** is a home automation engine that uses MQTT as its sole data source (zigbee2mqtt, Tasmota, ESPHome). It separates physical **Devices** (auto-discovered from MQTT) from user-facing **Equipments** (functional units like "Spots Salon"), provides automatic **Zone** aggregation, a **Scenario** engine with reusable **Recipe** templates, and exposes a reactive web UI.

The full specification is in [corbel-spec.md](corbel-spec.md) — it is the single source of truth. It is a living document that evolves alongside feature development; always re-read the relevant sections before implementing a milestone.

## Architecture

### Reactive Pipeline (core data flow)

```
MQTT message → MQTT Connector → Device Manager (updates DeviceData)
  → Event Bus: "device.data.updated"
    → Equipment Manager (re-evaluates bindings + computed Data)
      → Event Bus: "equipment.data.changed"
        → Zone Manager (re-evaluates aggregations)
          → Event Bus: "zone.data.changed"
            → Scenario Engine (evaluates triggers → conditions → actions)
              → Actions may emit Orders → MQTT publish
        → WebSocket pushes to UI clients
```

### Key Domain Concepts

| Term | Role |
|------|------|
| **Device** | Physical MQTT hardware, auto-discovered. Exposes raw Data and Orders. |
| **Equipment** | User-facing functional unit. Binds to one or more Devices. Can have computed Data and dispatched Orders. |
| **Zone** | Spatial grouping (nestable). Auto-aggregates Equipment Data (motion=OR, temperature=AVG, lightsOn=COUNT, etc.). |
| **Scenario** | Automation rule: trigger(s) → condition(s) → action(s). |
| **Recipe** | Reusable Scenario template with typed parameter slots. |

### Tech Stack

**Backend:** Node.js 20+ / TypeScript (strict) / Fastify / mqtt.js / SQLite (better-sqlite3) / InfluxDB 2.x / ws (WebSocket)

**Frontend:** React 18+ / TypeScript / Vite / Tailwind CSS / Zustand / Lucide React

**Infrastructure:** Docker + docker-compose / Mosquitto MQTT broker (external) / PM2

### Project Structure

```
corbel/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config.ts                # Env config loading
│   ├── core/                    # event-bus, database (SQLite), influx, logger
│   ├── mqtt/                    # MQTT connector + parsers (zigbee2mqtt, tasmota, generic)
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

### MQTT

- `mqtt.js` with `connectAsync` for async/await
- Always handle reconnection gracefully
- Parse payloads as JSON with try/catch fallback to raw string
- Message handlers must never throw — wrap in try/catch with logging

### Event Bus

- Typed EventEmitter with TypeScript discriminated union (`EngineEvent` type)
- All handlers must be non-blocking and never throw

### Expression Engine

- Safe expression parser (NOT `eval`) — consider `expr-eval` or custom
- References: `binding.<alias>`, `equipment.<id>.<key>`, `zone.<zoneId>.<key>`
- Operators: OR, AND, NOT, AVG, MIN, MAX, SUM, IF, THRESHOLD

### Authentication

- bcrypt (cost 12) for passwords, `jsonwebtoken` (HS256) for JWT
- API tokens: `cbl_` prefix, SHA-256 hash stored, generated via `crypto.randomBytes(32)`
- Auth middleware: try JWT decode first, then API token lookup
- Roles: admin > user > viewer (hierarchical permissions)

### Frontend

- Zustand stores updated by WebSocket events
- Auto-reconnecting WebSocket with state recovery (incremental or full)
- Tailwind CSS utility classes only — no custom CSS files
- Mobile-first responsive design (breakpoints: 640px, 1024px)

### Logging

- Structured JSON logging via pino (Fastify default)

## Design System

- **Font:** Inter (body), JetBrains Mono (values/logs)
- **Primary color:** `#1B6B5A` (light) / `#3DBDA0` (dark)
- **Accent color:** `#D4873F` (light) / `#E9A55C` (dark)
- **Spacing base unit:** 4px
- **Border radius:** 6px (buttons), 10px (cards), 14px (modals)
- **Body font size:** 14px (dense dashboard), Data values: 28px (readable at a glance)
- **Icons:** Lucide React, stroke 1.5px
- Dark mode via Tailwind `class` strategy — essential for nighttime dashboard use

## Development Roadmap

V0.1 MQTT+Devices → V0.2 Equipments+Bindings → V0.3 Zones+Aggregation → V0.4 UI+Realtime → V0.5 Computed Data → V0.6 History (InfluxDB) → V0.7 Scenario Engine → V0.8 Recipes → V0.9 Polish → V1.0+ AI Assistant

## Environment Variables

Key config via `.env`: `MQTT_URL`, `Z2M_BASE_TOPIC`, `SQLITE_PATH`, `INFLUX_URL`, `INFLUX_TOKEN`, `API_PORT`, `LATITUDE`/`LONGITUDE`/`TIMEZONE`, `JWT_SECRET`, `LOG_LEVEL`, `CORS_ORIGINS`, `TRUST_PROXY`.
