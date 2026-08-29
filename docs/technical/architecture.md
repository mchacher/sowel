# Architecture Overview

This document describes Sowel's technical architecture: the tech stack, project structure, reactive pipeline, key domain concepts, and design system.

---

## Tech Stack

### Backend

| Technology                   | Role                                         |
| ---------------------------- | -------------------------------------------- |
| **Node.js 24+**              | Runtime                                      |
| **TypeScript** (strict mode) | Language                                     |
| **Fastify**                  | HTTP framework                               |
| **SQLite** (better-sqlite3)  | Primary database (synchronous API, WAL mode) |
| **InfluxDB 2.x**             | Time-series storage (history, energy)        |
| **ws**                       | WebSocket server                             |
| **mqtt.js**                  | MQTT client for device integrations          |
| **pino**                     | Structured JSON logging                      |

### Frontend

| Technology         | Role                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **React 19**       | UI framework                                                                                                                   |
| **TypeScript**     | Language                                                                                                                       |
| **Vite**           | Build tool and dev server                                                                                                      |
| **Tailwind CSS 4** | Styling (utility classes only). v4 is config-less: there is no `tailwind.config.js`, tokens live in `design-system/tokens.css` |
| **Zustand**        | State management                                                                                                               |
| **Lucide React**   | Icon library (stroke 1.5px)                                                                                                    |

### Infrastructure

| Technology                  | Role                             |
| --------------------------- | -------------------------------- |
| **Docker + docker-compose** | Containerized deployment         |
| **Docker restart policy**   | Process supervision (production) |

---

## Key Domain Concepts

| Term          | Role                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Device**    | Physical hardware, auto-discovered from integrations. Exposes raw Data and Orders.                                                      |
| **Equipment** | User-facing functional unit. Binds to one or more Devices. Can have computed Data and dispatched Orders.                                |
| **Zone**      | Spatial grouping (nestable tree). Auto-aggregates Equipment Data (motion=OR, temperature=AVG, lightsOn=COUNT, etc.).                    |
| **Recipe**    | Automation template with typed parameter slots: trigger(s) -> condition(s) -> action(s). A configured, running copy is an **instance**. |
| **Mode**      | Named state (e.g. "Night", "Away") with zone-level impacts. Can be activated manually, by calendar, or by button press.                 |

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
                -> Recipe Engine (evaluates triggers -> conditions -> actions)
                  -> Actions may emit Orders -> Integration Plugin -> device
            -> MQTT Publish Service (outbound to external brokers, with optional on-change filter)
            -> Notification Publish Service (Telegram, etc.)
            -> WebSocket pushes to UI clients
```

### Event Bus

The Event Bus is a typed `EventEmitter` using TypeScript discriminated unions (`EngineEvent` type). It is the backbone connecting all managers. Key rules:

- All handlers must be non-blocking and must never throw.
- Events are batched (200ms interval) before being sent to WebSocket clients.
- High-frequency data events (`device.data.updated`, `equipment.data.changed`, `zone.data.changed`) are deduplicated per batch -- only the latest value per key is sent.

### Event Types

| Event                             | Payload                                              | When                                  |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `device.discovered`               | `device: Device`                                     | New device found                      |
| `device.removed`                  | `deviceId, deviceName`                               | Device deleted                        |
| `device.status_changed`           | `deviceId, deviceName, status`                       | Online/offline                        |
| `device.data.updated`             | `deviceId, deviceName, dataId, key, value, previous` | Property change                       |
| `equipment.data.changed`          | `equipmentId, alias, value, previous`                | Bound data changed                    |
| `equipment.order.executed`        | `equipmentId, orderAlias, value, source?`            | Order dispatched                      |
| `zone.data.changed`               | `zoneId, aggregatedData`                             | Aggregated data changed (whole set)   |
| `system.started`                  | --                                                   | Engine boot complete                  |
| `system.integration.connected`    | `integrationId`                                      | Integration connected                 |
| `system.integration.disconnected` | `integrationId`                                      | Integration disconnected              |
| `settings.changed`                | `keys`                                               | Settings updated                      |
| `mode.activated`                  | mode details                                         | Mode activated                        |
| `mode.deactivated`                | mode details                                         | Mode deactivated                      |
| `recipe.instance.state.changed`   | instance details                                     | Recipe state changed                  |
| `activity.added`                  | `item: ActivityItem`                                 | New activity item buffered (spec 101) |

---

## Project Structure

```
sowel/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config.ts                # Env config loading
│   ├── core/                    # event-bus, database (SQLite), influx, logger, settings-manager,
│   │                            # timezone, version-checker, update-manager, shutdown
│   ├── integrations/            # IntegrationRegistry only — the runtime registry plugins
│   │                            # register into. No integration lives here (spec 053)
│   ├── plugins/                 # PluginLoader + scoped-deps (soft isolation, spec 111)
│   ├── packages/                # PackageManager: GitHub distribution, registry, personal sources
│   ├── devices/                 # Device manager, auto-discovery, category inference
│   ├── equipments/              # Equipment manager, bindings, computed engine, order dispatcher,
│   │                            # order confirmation tracker (spec 141)
│   ├── energy/                  # Energy aggregator, tariff classifier, capacity arbiter
│   ├── zones/                   # Zone manager, auto-aggregation engine, sunlight
│   ├── modes/                   # Mode manager, calendar manager
│   ├── recipes/                 # RecipeLoader + engine. Recipes themselves are packages
│   ├── weather/                 # Weather aggregation, forecast models, PV forecast
│   ├── activity/                # Activity buffer + store (spec 147)
│   ├── backup/                  # BackupManager (export/restore, local backups)
│   ├── buttons/                 # Button action bindings (physical button -> mode/order)
│   ├── charts/                  # Saved chart configurations
│   ├── history/                 # InfluxDB history writer and query helpers
│   ├── mqtt-publishers/         # Outbound MQTT publishing (broker, publisher, on-change filter)
│   ├── notifications/           # Notification channels (Telegram, ntfy, web push)
│   ├── auth/                    # JWT + API tokens, MFA, middleware, user manager, first-run setup
│   ├── api/                     # Fastify server, WebSocket handler, route files
│   │   ├── server.ts            # Server setup and route registration
│   │   ├── websocket.ts         # WebSocket handler with topic subscriptions
│   │   └── routes/              # One file per domain (auth, devices, zones, etc.)
│   ├── test-helpers/            # Shared test fixtures
│   └── shared/                  # types.ts (all interfaces), constants.ts, plugin-api.ts
├── ui/                          # React frontend (separate Vite project)
│   └── src/
│       ├── store/               # Zustand stores (devices, equipments, zones, WebSocket)
│       ├── components/          # By domain: dashboard/, devices/, equipments/, energy/, recipes/
│       ├── pages/               # Dashboard, Devices, Equipments, Zones, Energy, Settings
│       └── i18n/                # Internationalization (en.json, fr.json)
├── plugins/                     # Installed plugin directory + registry.json
├── migrations/                  # SQLite migration SQL files
├── specs/                       # Feature specifications (XXX-name/)
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

### Trust tiers (specs 089 + 136)

Three trust tiers govern where a package may come from and what integrity anchor protects it:

| Tier          | Source of truth                     | Integrity anchor                     | Install friction                            |
| ------------- | ----------------------------------- | ------------------------------------ | ------------------------------------------- |
| **Official**  | Central registry, whitelisted owner | Registry SHA256 + maintainer review  | None                                        |
| **Community** | Central registry, third-party owner | Registry SHA256 + registry PR review | One-time confirmation modal                 |
| **Personal**  | Admin-added GitHub repo (spec 136)  | TOFU-pinned SHA256                   | Confirmation at install and at every update |

**Personal sources** (spec 136) let an admin register their own public GitHub repos as plugin sources, bypassing the central registry entirely. `PersonalSourceManager` (`src/packages/personal-sources.ts`) owns the `plugin_sources` table and a cached view of each repo's latest release. Trust is on-first-use: the install downloads the tarball, shows its SHA256 in a confirmation modal, then pins the hash in `plugins.pinned_sha256`. Updates whose tarball differs from the pinned hash require a fresh confirmation; backup restores re-verify downloads against the pinned hash. All spec 089 tarball hardening (hash verification, tar flags, escaping-symlink refusal) applies identically, plus personal-only checks: the manifest `repo` must match the source, the plugin id must not shadow a registry id, and `sowelVersion` compatibility is enforced. Installed packages carry `plugins.source` (`registry` or `personal`); version checks for personal packages read the source repo's releases, never the registry.

### Plugin manifest format

Each plugin ships a `manifest.json` with `id`, `type` (`integration` or `recipe`), `name`, `description`, `icon` (Lucide name), `author`, `repo`, `version`, `tags`. See [plugin-development.md](plugin-development.md) for the full spec.

### Integration lifecycle

1. **Load** — `PluginLoader.loadAll()` scans the `plugins` table, imports each enabled entry, calls `createPlugin(deps)`, registers with `IntegrationRegistry`.
2. **Start** — `IntegrationRegistry.startAll()` starts plugins one after another, awaiting each. The 10 s stagger is a `pollOffset` handed to polling plugins, not a delay between starts. Each plugin's `start()` connects, discovers devices, begins polling. `start()` returning does **not** mean the plugin is reachable: MQTT connects and cloud logins complete asynchronously afterwards.
3. **Connected** — the registry samples every plugin's `getStatus()` and emits `system.integration.connected` / `system.integration.disconnected` on each transition. This is the engine's own signal, independent of what a plugin chooses to emit, and it is what makes an integration's recovery observable (see [Order delivery](#order-delivery-when-an-integration-is-unreachable) below).
4. **Runtime** — Plugin pushes data via `deviceManager.updateDeviceData()`. Orders go out via `plugin.executeOrder()`.
5. **Stop** — `stop()` cancels timers, closes connections.
6. **Update** — Unload → `PackageManager.updateFiles()` → reload.
7. **Uninstall** — Unload → `PackageManager.removeFiles()`.

Settings for integrations are stored in SQLite `settings` under `integration.<id>.<key>`, configured from the UI.

#### Order delivery when an integration is unreachable

An order dispatched at a disconnected integration never reaches the wire. Rather than being dropped with a log line, it is held by the order confirmation tracker (spec 141) and re-dispatched **once** when that integration connects, within a short window: a schedule-driven command replayed long after its slot would be worse than the one that was lost. The caller still gets the same error it always did.

Recipe instances are the reason this used to matter on every restart: they start at the very end of boot, behind a bounded wait on the integrations reporting connected, because an instance evaluates and dispatches as soon as it starts. The wait is capped so one unreachable cloud integration cannot hold every automation, and whatever still slips through is caught by the hold-and-replay above. The API and the recipe list do not wait; only running-instance state does.

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
| `weather-forecast`      | `mchacher/sowel-plugin-weather-forecast`      | integration |
| `smartthings`           | `mchacher/sowel-plugin-smartthings`           | integration |
| `motion-light`          | `mchacher/sowel-recipe-motion-light`          | recipe      |
| `motion-light-dimmable` | `mchacher/sowel-recipe-motion-light-dimmable` | recipe      |
| `switch-light`          | `mchacher/sowel-recipe-switch-light`          | recipe      |
| `presence-heater`       | `mchacher/sowel-recipe-presence-heater`       | recipe      |
| `presence-thermostat`   | `mchacher/sowel-recipe-presence-thermostat`   | recipe      |
| `state-watch`           | `mchacher/sowel-recipe-state-watch`           | recipe      |
| `state-trigger-light`   | `mchacher/sowel-recipe-state-trigger-light`   | recipe      |

The live list is in `plugins/registry.json` at the repo root.

---

## Database Architecture

### SQLite

- **Library**: `better-sqlite3` with intentionally synchronous API (fast, no callback overhead).
- **WAL mode**: `PRAGMA journal_mode=WAL` for concurrent read/write.
- **`PRAGMA synchronous=NORMAL`** (issue #694): pinned rather than inherited.
  The effective value was already NORMAL, but only because better-sqlite3
  compiles `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` and SQLite applies it to a
  database already in WAL mode at open; a brand-new file is created in `delete`
  mode, takes FULL, and switching it to WAL afterwards does not re-apply the WAL
  default, so a fresh install ran its first process lifetime at FULL. Setting it
  explicitly makes the choice ours instead of a dependency's compile flag, and
  `database.test.ts` pins it. **The trade-off NORMAL accepts**: a power loss or
  an OS crash can lose transactions committed since the last checkpoint (up to
  ~4 MB of WAL at the default `wal_autocheckpoint`, so potentially minutes of
  writes, though Linux writeback makes the realistic loss far smaller). It
  cannot corrupt the database, recovery is prefix-consistent, and a process
  crash or container restart loses nothing — but a VM hard-stop is a guest power
  loss, not a restart. Note this governs _when_ SQLite fsyncs, never how many
  pages it writes: it is not a write-amplification fix.
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

InfluxDB is optional -- a failed connection is logged and the engine keeps running, with history and energy aggregation degraded. When it does connect, Sowel auto-creates buckets, downsampling tasks, and energy aggregation tasks.

#### Energy deltas are accumulated, never sampled

An `energy` binding carries an **additive delta** (Wh since the previous tick), not a measurement. The deduplication that protects the other categories (deadband, 30 s min-write interval) would silently destroy energy: meters differ wildly in cadence -- a Shelly EM emits one tick a minute, a Tuya PJ-1203A emits ~30, of which a single one carries the 10 Wh counter jump.

So `HistoryWriter` accumulates live `energy` ticks per minute and writes one point aligned on the minute start, HP/HC split included. `SelfConsumptionWriter` accumulates the paired Grid + Solar minute the same way and derives `autoconso` / `injection` / household from the summed minute.

#### One authority per series

The two writers close their per-minute buckets on different triggers -- `HistoryWriter` per binding, `SelfConsumptionWriter` on the first tick of the next minute from either meter. Sharing a series between them would therefore be a last-write-wins race decided by which meter happens to tick first, so ownership of the grid meter's `energy` / `energy_hp` / `energy_hc` is exclusive:

- **With an `energy_production_meter` configured**, `SelfConsumptionWriter` is their sole writer (household semantic), and `HistoryWriter` skips exactly those three aliases on the `main_energy_meter`. It keeps writing everything else: power, voltage, `energy_forward` / `energy_reverse`, every sub-meter, and the solar meter's own energy.
- **Solo grid (no production meter)**, `SelfConsumptionWriter` is inert and `HistoryWriter` writes the raw accumulated grid energy as usual.

Ownership follows the equipment cache, so adding or removing the production meter at runtime hands the series over without a restart.

Two consequences worth knowing:

- Every minute that saw a grid tick is written. A minute with no solar tick is not a hole: it is a pure grid import (`autoconso = 0`). Only a solar-only minute is dropped -- injection is undefined without the grid side.
- Ticks carrying an explicit `sourceTimestamp` (plugins that post aligned historical windows, e.g. 30-min Netatmo/Legrand windows) are already aggregated, so `HistoryWriter` writes them through unchanged and the HP/HC split is classified over 30 minutes rather than the 60 s of a live bucket.

---

## Energy Capacity Arbiter (spec 140)

One core component (`src/energy/capacity-arbiter.ts`) is the single reader of
the grid meter for arbitration purposes and allocates the solar surplus
between declared flexible loads. Key invariants:

- **Reservation accounting**: `availableW = exportW + Σ effectiveWatts(grants)`
  on the SIGNED meter reading — an export collapse caused by its own grants is
  never a deficit; an import is. Effective watts are three-tiered: fresh live
  draw (the load's own power binding), else a learned nominal (trimmed median
  of past runs, sub-threshold samples excluded), else the declared profile.
- **User-owned priority**: one ordered list (settings) read top-down to grant,
  bottom-up to revoke. Claims may self-demote (`slack`) but can never step up.
- **The arbiter issues no orders** in phase 1: recipes act through
  `ctx.helpers.energy.claimCapacity()` callbacks; grants are runtime-only and
  rebuilt after a restart. Manual orders and wall-switch state divergences
  suspend arbitration per equipment (TTL, "resume control now" in the UI).
- **Everything is journaled** (bounded ring, `GET /api/v1/energy/arbiter`) and
  surfaced on Energy → Live (allocation bar, day timeline, decision journal).
  Default off: `energy.arbiter.enabled = false` means zero behavior change.

### Daily metrics (spec 158)

The decision journal and the surplus series are purged after 7 days, which made
any retrospective study of the arbiter impossible past a week. An hour-aligned
rollup (`src/energy/arbiter-metrics-rollup.ts`) recomputes **today and
yesterday** on every tick into `arbiter_daily_load_metrics` and
`arbiter_daily_home_metrics`, kept 400 days. Today's row is partial by
construction (the window is clamped to `now`) and the first tick after midnight
completes it; recomputing yesterday every tick is what makes a restart across a
day boundary a non-event.

- **It never touches the arbiter.** Everything it needs is elsewhere: the two
  persisted stores, the equipments' energy profiles, and two settings values.
  `capacity-arbiter.ts` is not modified, so arbitration cannot be destabilised
  by a change to the metrics.
- **One definition of state**: spans are derived with `sustainedAfter()`, the
  same function the timeline paints with. A metric that disagreed with the
  ribbon on screen would be worse than no metric.
- **The headline figure is the short cycle**: a grant revoked inside
  `minOnS + releaseHoldS`, i.e. a load that started on a surplus that did not
  hold. That is the number every later tuning change is judged against.
- Two export figures, kept apart because they answer different questions:
  `waitingExportWh` (a load was claiming the surplus and did not get it — the
  arbiter's own miss, 3 % on the reference installation) and
  `idleClaimableExportWh` (a **deferrable** load was not running while the
  surplus covered its need — nobody asked, so it is the scheduling opportunity
  a planner would harvest, 46 %). Comfort loads are excluded from the idle
  figure: an idle heat pump means the house is comfortable. Merged into one
  number the figure read 75 % "missed" and made a healthy arbiter look broken.
  Both are **estimates** (5-minute sampling, profiles read at rollup time) and
  the API flags them in `estimates`.
- Reads are capped at 20 000 decision rows per day and a truncation is logged,
  never silent. A whole tick is written in one transaction: one commit and one
  fsync per hour rather than fourteen, which is what keeps the write wear
  negligible on a flash-booted box.

Read through `GET /api/v1/energy/arbiter/metrics` or
`scripts/energy/arbiter-metrics.ts`, which opens SQLite directly and therefore
works against a restored backup with no running instance.

Full design, review log and rationale: `specs/140-energy-capacity-arbiter/`.

## Authentication & Authorization

- **Passwords**: bcrypt (cost 12).
- **JWT**: HS256 via `jsonwebtoken`. Access token TTL: 15 min. Refresh token TTL: 30 days.
- **API tokens**: `swl_` prefix, SHA-256 hash stored, generated via `crypto.randomBytes(32)`. Legacy prefixes `wch_` and `cbl_` also accepted.
- **Auth-by-default** (spec 105): a global Fastify `onRequest` hook enforces authentication on every `/api/v1/*` route. The list of public routes is the `PUBLIC_ROUTES` constant in `src/auth/auth-middleware.ts` (`/health`, `/auth/status`, `/auth/setup`, `/auth/login`, `/auth/refresh`, `/auth/mfa/verify`) plus OAuth callback paths. Any new route is protected unless explicitly added to that whitelist.
- **Roles**: `admin` > `standard` > `viewer` (hierarchical permissions).
- **First-run setup**: `POST /api/v1/auth/setup` creates the first admin user.

### Two-factor authentication (spec 151)

Optional per-user TOTP (RFC 6238, `otplib`) second factor, opt-in from Settings → Account. `MfaService` (`src/auth/mfa-service.ts`) owns enrollment, verification, single-use backup codes (10, SHA-256 hashed, regenerable), and trusted devices.

- **Login flow**: `AuthService.login()` returns an `MfaChallenge` (`{ mfaRequired: true, mfaToken }`) instead of full tokens when the account has confirmed MFA and no valid trusted-device token was presented. `POST /auth/mfa/verify` (public) exchanges a TOTP/backup code for full tokens.
- **Token purpose isolation**: `JwtPayload` carries `purpose: "access" | "mfa_pending"`. `AuthService.verifyAccessToken()` — used by the global auth hook on every protected route — rejects any `mfa_pending` token outright, so a replayed `mfaToken` can never grant partial API access before the second factor is checked.
- **Trusted devices**: an opaque token (SHA-256 hashed server-side) lets a later login skip the MFA step. Duration is a per-user preference, `UserPreferences.mfaTrustedDeviceDays` (1-90, default 30), clamped in `PUT /me/preferences`. Changing the account password revokes all trusted devices for that account.
- **Recovery**: no email/SMS fallback. An admin can force-disable another user's MFA (`DELETE /users/:id/mfa`); a self-locked-out admin uses the break-glass CLI, `scripts/auth/reset-mfa.mjs <username>` (via `docker exec`).
- **Data model**: `user_mfa_totp`, `user_mfa_backup_codes`, `mfa_trusted_devices` tables (migration `022_mfa_totp.sql`) — no columns added to `users`.

See `specs/151-mfa-totp/` for the full design.

### WebSocket authentication (spec 105)

The `/ws` endpoint requires authentication. Browser clients pass the token via the `Sec-WebSocket-Protocol: bearer.<token>` subprotocol (the WebSocket API does not allow custom headers). Non-browser clients (scripts, integrations) may use `Authorization: Bearer <token>` instead. Anonymous connections are refused with close code 4001. Connections with an `Origin` header not in the CORS whitelist are refused with 4003.

### Security headers (spec 105)

The Fastify server registers `@fastify/helmet` with a Content-Security-Policy that allows only same-origin scripts, inline styles (for Tailwind), and WebSocket connections. `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and conditional HSTS (only when the request arrived over HTTPS) are emitted.

### CORS defaults

`CORS_ORIGINS` defaults to `http://localhost:3000,http://localhost:5173`. Setting it to `*` is permitted but emits a startup warning, doubled when `API_HOST` is not loopback.

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

| Property           | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| **Body font**      | Inter                                                    |
| **Monospace font** | JetBrains Mono (values, logs)                            |
| **Primary color**  | `#1A4F6E` (ocean blue), hover `#144159`, light `#EEF5F8` |
| **Accent color**   | `#F2C035` (amber), hover `#D4A41C`                       |
| **Spacing base**   | 4px                                                      |
| **Border radius**  | 6px / 8px / 12px (`--radius-sm/md/lg`)                   |
| **Body font size** | 14px (dense dashboard)                                   |
| **Data values**    | 28px (readable at a glance)                              |
| **Icons**          | Lucide React, stroke 1.5px                               |

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

| Entry                     | Content                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sowel-backup.json`       | SQLite export as JSON, structured per table (version 2 format)                                                                                |
| `influx-raw.lp`           | Raw InfluxDB data as line protocol (last 7 days)                                                                                              |
| `influx-hourly.lp`        | Downsampled hourly data (last 90 days)                                                                                                        |
| `influx-daily.lp`         | Downsampled daily data (last 5 years)                                                                                                         |
| `influx-energy-hourly.lp` | Energy hourly sums (last 2 years)                                                                                                             |
| `influx-energy-daily.lp`  | Energy daily sums (last 10 years)                                                                                                             |
| `data/*`                  | All non-DB files from `data/` (token secrets, etc.), dynamically scanned, excluding `.db`, `.pid`, `.log` files and the `.instance-id` marker |

The SQLite JSON export covers a curated list of tables (`BACKUP_TABLES` constant in `backup-manager.ts`) in dependency order (parents first for restore).

The `.instance-id` marker is excluded on purpose, in both directions: it describes the deployment currently running, and an archive that carried it would hand a restoring instance the identity of the machine the data came from, disarming the #401 restored-data guardrail. See the "Restoring a backup from another deployment" section of [deployment.md](deployment.md).

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
   - `AutoRemove: false`, deliberately, so `docker logs sowel-updater` survives the run
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
2. **docker jobs** — build `linux/amd64` and `linux/arm64` with Buildx, push to `ghcr.io/mchacher/sowel:<version>`, then a `promote-manifest` job merges them into one multi-architecture `:latest`, and a GitHub Release is created with auto-generated notes

The Docker build is **multi-architecture**: amd64 and arm64 are built in parallel jobs and merged into a single manifest, so `docker pull` resolves the right one.

### Release script

`scripts/release.sh <version>`:

1. Validates semver format and clean working tree
2. **Asserts** `package.json` and `ui/package.json` are already at that version, and exits otherwise. It does not bump them: a normal PR does, and merges before the tag
3. Tags `vX.Y.Z` and pushes the tag to origin
4. GitHub Actions takes over from there

It runs no validation of its own, and it does not commit. Branch protection means the version bump and release notes land through a PR first.

A Claude Code skill wraps this at `.claude/skills/sowel-release/SKILL.md`.

### Docker image (`Dockerfile`)

Multi-stage build:

1. **backend-build** — Node 24, `tsc` backend
2. **ui-build** — Node 24, Vite UI build
3. **runtime** — Debian Trixie (for Python 3.13), Node 24 installed via NodeSource, Python 3.13 + venv for plugins that need it (e.g. Panasonic CC), `better-sqlite3` rebuilt for the platform

Runtime image is ~950 MB uncompressed (~210 MB content). The Python 3.13 requirement dates from the Panasonic CC plugin needing f-string syntax unavailable in Python 3.11.

---

## Activity Buffer (spec 101)

`src/activity/activity-buffer.ts` keeps the last **7 days** of zone-scoped engine events (capped at 2000 items in memory), persisted to the `activity_log` table and reloaded on boot. It powers the **Activity** panel in the zone view ([user guide](../user/zones.md#activity-feed)).

### Event flow

1. The buffer subscribes to a curated set of `EngineEvent`s: `equipment.order.executed`, `equipment.data.changed` (filtered by binding category to `motion`, `water_leak`, `smoke`), `recipe.instance.started/stopped/error`, `mode.activated/deactivated`, `sunlight.changed`, `system.alarm.raised`, `system.alarm.resolved`. A resolution is filed in the zone its event carries, falling back to the zone of the raise the buffer saw (global when it has neither, e.g. an alarm raised before a restart).
2. For each event it resolves equipment / recipe names and the relevant `zoneId` via the equipment, recipe, zone and sunlight managers, then builds an `ActivityItem`.
3. It pushes the item to the ring buffer (capping by count, purging stale entries past the TTL) and emits an `activity.added` event on the bus.
4. The WebSocket layer broadcasts that event to clients subscribed to the `activity` topic. Clients also bootstrap from `GET /api/v1/activity` on mount.

### Source attribution

`executeOrder()` accepts an optional 4th `source` argument of type `OrderSource`. The recipe SDK exposes a per-instance `ctx.dispatchOrder()` closure that pre-binds the recipe's source, so internal helpers never have to thread `source` themselves. Modes, button bindings and API routes pass source inline. External recipe plugins keep working without attribution (graceful degradation).

### Memory footprint

At ~400 bytes per item, 2000 items = ~800 KB — under 0.3 % of a typical Sowel container's RSS. Unlike the logs ring buffer, the feed **survives a restart**: it is backed by SQLite (spec 147).

---

## Logging

### Strategy

Pino structured JSON logging with multistream output (see `src/core/logger.ts`):

- **Ring buffer** — in-memory circular buffer for UI log viewer (always captures debug level)
- **stdout** — raw JSON in production (captured by Docker logs), pino-pretty in development
- **File transport** — in production only, via `pino-roll` to `data/logs/sowel.<yyyy-MM-dd>.N.log`, daily rotation, keep 14 files (retention also applies to files left by previous containers)

### Log file location

`/app/data/logs/sowel.<yyyy-MM-dd>.N.log` inside the container (on the `sowel-data` volume). One calendar day maps to one predictable file, even across container restarts and self-updates. **Survives container recreation** — essential for post-incident investigation after a self-update.

Example retrieval:

```bash
docker exec sowel sh -c 'cat /app/data/logs/sowel.2026-04-11.1.log | grep -E "2026-04-11T07:" | grep error'
```

Before v1.39, files were named `sowel.N.log` with a rotation number picked per process: several restarts a day interleaved time ranges across files, and one file could span months. When investigating an incident older than the format switch, grep ALL `sowel.*.log` files rather than trusting one. Legacy numbered files are invisible to the new retention, so the engine purges them automatically at boot once they are older than 14 days; no manual action is needed.

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
- **From file** — `docker exec` into `/app/data/logs/sowel.*.log` (persistent)
- **Helper script** — `scripts/logs/fetch-logs.py <module> <level> <limit>` with `SOWEL_URL` + `SOWEL_PASSWORD` env vars

---

## Timezone handling (spec 061) { #timezone-handling }

Sowel backend logic depends heavily on local time: calendar cron slots (`croner`), energy HP/HC tariff classification, energy day boundaries, sunrise/sunset display, notifications. All use native `Date` methods that depend on `process.env.TZ`.

### Detection strategy

At startup, `src/core/timezone.ts` determines the timezone with this priority:

1. **`TZ` env var** — if set in `docker-compose.yml` or the host env, Sowel respects it (explicit override wins)
2. **`home.latitude` / `home.longitude`** — if configured in Settings, Sowel passes them to `tz-lookup` to derive the IANA timezone name (e.g. `Europe/Paris`)
3. **Fallback to UTC** — with a loud WARN log inviting the user to configure a home location

`process.env.TZ` is set **before `createLogger()`** in `src/index.ts`. This is critical — pino's first `new Date()` call caches the TZ in V8, and `process.env.TZ` changes after that have no effect on already-loaded `Date.prototype` methods. See the boot sequence in `src/index.ts`.

### Restart required after location change

Node caches the TZ on first use. If the user changes `home.latitude` / `home.longitude` in Settings at runtime:

1. The settings route logs a warn and emits `system.restart_required` on the EventBus
2. The UI receives the event via WebSocket and displays `RestartToast` with a "Restart now" button
3. Clicking the button calls `POST /api/v1/system/restart` which spawns a `docker:25-cli` helper container (same pattern as spec 060 self-update) that runs `docker compose up -d --force-recreate sowel` (without `--force-recreate` compose sees no diff and silently does nothing)
4. The helper survives Sowel's death and recreates the container, which picks up the new env and re-runs `detectTimezone()` with the new coordinates
5. The existing `UpdateOverlay` reloads the UI on WS reconnect

### Exposing the TZ in the UI

- `GET /api/v1/system/timezone` returns `{ tz, source, offsetHours }` to any authenticated user
- `ui/src/store/useTimezone.ts` caches the result in a Zustand store, fetched once at app mount from `AppLayout.tsx`
- The Settings → Home section displays the TZ read-only with its source label (auto / env / fallback)
- The `CurrentTimePill` in the header banner displays the **home** time (not the browser local time), computed via `Intl.DateTimeFormat(undefined, { timeZone: tz, ... })` — useful when accessing Sowel from a device in a different timezone

See spec 061 at [github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location](https://github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location).

---

## Environment Variables

All settings are optional with sensible defaults -- Sowel runs zero-config out of the box. Override via `.env` if needed:

| Variable          | Default                         | Notes                                                                                |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `SQLITE_PATH`     | `./data/sowel.db`               | SQLite database path                                                                 |
| `API_PORT`        | `3000`                          | HTTP server port                                                                     |
| `API_HOST`        | `0.0.0.0`                       | Bind address                                                                         |
| `JWT_SECRET`      | auto-generated                  | Persisted in `data/.jwt-secret` on first launch                                      |
| `JWT_ACCESS_TTL`  | `900`                           | Access token TTL in seconds (15 min)                                                 |
| `JWT_REFRESH_TTL` | `2592000`                       | Refresh token TTL in seconds (30 days)                                               |
| `LOG_LEVEL`       | `info`                          | Pino log level                                                                       |
| `CORS_ORIGINS`    | `localhost:3000,localhost:5173` | Comma-separated allowed origins. `*` is permitted but warns at startup               |
| `INFLUX_URL`      | `http://localhost:8086`         | InfluxDB 2.x URL                                                                     |
| `INFLUX_TOKEN`    | shared default constant         | Matches `docker-compose.yml`. `data/.influx-token` is read if present, never written |
| `INFLUX_ORG`      | `sowel`                         | InfluxDB organization                                                                |
| `INFLUX_BUCKET`   | `sowel`                         | InfluxDB primary bucket                                                              |
| `TZ`              | system default (UTC in Docker)  | IANA timezone. Set explicitly in docker-compose to fix time-based logic.             |

Integration settings (MQTT, cloud credentials, polling intervals) are configured from the UI, not from `.env`.
