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

## Integration Architecture

Sowel uses a plugin-based architecture for device integrations. Each device source implements the `IntegrationPlugin` interface and registers with the `IntegrationRegistry`.

### Built-in Integrations

| Integration             | Protocol          | Discovery                        |
| ----------------------- | ----------------- | -------------------------------- |
| Zigbee2MQTT             | MQTT              | Automatic (bridge/devices topic) |
| Panasonic Comfort Cloud | Cloud API polling | Automatic (API device list)      |
| MCZ Maestro             | Cloud API polling | Automatic (API device list)      |
| Netatmo Home Coach      | Cloud API polling | Automatic (API device list)      |

### Third-party Plugins

Plugins are ESM Node.js packages installed in the `plugins/` directory. They export a `createPlugin` factory function that receives a `PluginDeps` object. See the [Plugin Development Guide](plugin-development.md) for details.

### Integration Lifecycle

1. **Registration**: Plugin registers with `IntegrationRegistry`.
2. **Configuration check**: `isConfigured()` must return true before starting.
3. **Start**: `start()` is called -- plugin connects, discovers devices, begins polling.
4. **Runtime**: Plugin pushes device data via `deviceManager.updateDeviceData()`.
5. **Stop**: `stop()` is called -- plugin cancels timers, closes connections.

Settings for integrations are stored in the SQLite `settings` table under `integration.<id>.<key>` and configurable from the UI (Administration > Integrations).

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

Integration settings (MQTT, cloud credentials, polling intervals) are configured from the UI, not from `.env`.
