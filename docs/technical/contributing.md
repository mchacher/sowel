# Contributing to Sowel

This guide covers everything a contributor needs to know to set up the development environment, follow the project conventions, and submit changes.

---

## Development Setup

### Prerequisites

- **Node.js 24**, the line CI, the release build and the shipped image all run.
  `.nvmrc` and `.node-version` pin it, so nvm, fnm and asdf pick it up on `cd`.
  Do not read the `>=24.0.0` in `package.json` as an invitation to run 25: odd
  Node lines never become LTS, and Homebrew's plain `node` formula tracks them.
  Without a version manager, `brew install node@24` and put
  `/opt/homebrew/opt/node@24/bin` ahead on your PATH.
- **npm** (comes with Node.js)
- **Docker + docker-compose** (for InfluxDB)
- **Git**

### Backend

```bash
git clone <repo-url>
cd sowel
npm install
npm run dev          # Development with hot reload (tsx watch)
```

### Frontend

```bash
cd ui
npm install
npm run dev          # Vite dev server (hot module replacement)
```

### Docker (InfluxDB)

```bash
docker compose up -d     # Starts InfluxDB 2.x
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
npx vitest run -t "pattern"      # Run specific tests
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
- For Dependabot PRs (bumps, security patches, coupled major upgrades), follow the [Dependency Management](dependency-management.md) playbook.

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
- Auth is on by default: an `onRequest` hook authenticates every route except `PUBLIC_ROUTES` (spec 105).
- Roles: `admin` > `standard` (two roles; there is no `viewer`) (hierarchical permissions).

### Frontend

- **Zustand** stores updated by WebSocket events.
- Auto-reconnecting WebSocket with state recovery (incremental or full).
- **Tailwind CSS utility classes only** -- no custom CSS files.
- **Mobile-first** responsive design (breakpoints: 640px, 1024px).
- **Dark mode** via Tailwind `class` strategy.
- **Icons**: Lucide React, stroke 1.5px.

#### Translations (i18n)

Every visible string is a key in `ui/src/i18n/locales/fr.json` **and** `en.json` (the two files hold exactly the same keys). Tests in `ui/src/i18n/` enforce the rules below:

- **No hard-coded word.** On/off states read `controls.on` / `controls.off` (« Marche » / « Arrêt »), never a literal `"ON"`; a colon after a label is `t("common.colon")`, never `": "`. Values sent to devices (`"ON"`, `true`) are not display text and stay as they are.
- **Plurals** use i18next plural keys: `key_one` and `key_other`, called as `t("key", { count })`. Never glue a count to a fixed plural word (`{n} {t("devices")}`) and never write `(s)`. A key called with `count` without both forms fails `plurals.test.ts`, unless its text cannot change with the count (an abbreviated unit, « 3 j »): then it goes in that test's `INVARIANT` list.
- **Categories**: every `DataCategory` has a `category.<name>` label in both languages. `locale-completeness.test.ts` lists the union exhaustively, so a category added to `ui/src/types.ts` without a label does not compile.
- **French typography** (`fr-typography.test.ts`): a narrow no-break space (U+202F) before `: ; ! ?` and inside « », the ellipsis character `…` rather than `...`, the straight apostrophe `'` only. A French value equal to its English one fails the test unless it is listed in `SAME_AS_EN` (proper nouns, acronyms, words both languages share, admin terms kept on purpose such as broker or topic).

#### Numbers and units

Every displayed number goes through `ui/src/lib/format.ts`, never through `toFixed`, a bare `toLocaleString()` or a hand-made `Intl.NumberFormat`. The module follows the UI language: in French a decimal comma, a narrow no-break space (U+202F) between thousands and before the unit (« 1 288 lx », « 14,3 kWh », « 39 % »), the minus sign U+2212 and never « −0 »; in English the dot, a comma between thousands and « 39% ». `null`, `undefined` and `NaN` read « — ». An ESLint rule (`no-restricted-syntax` in `ui/eslint.config.js`, checked by `format-lint.test.ts`) fails on `toFixed`, `new Intl.NumberFormat` and `toLocaleString()` outside the module, and on a `toLocaleDateString`/`toLocaleTimeString`/`toLocaleString` given no locale, `undefined` or `[]`, which follow the browser's language instead of Sowel's: pass `currentLocale()` from the module. A value that is not displayed (an SVG coordinate) rounds with `Math.round`.

| Quantity                                        | Function             | Precision                                                                                               | French example                                      |
| ----------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Temperature, setpoint                           | `formatTemperature`  | 1 fixed decimal; `compact` in tiles, rows and strips, `full` in pages, axes and tooltips                | « 20,0° », « 20,5 °C »                              |
| Power                                           | `formatPower`        | whole W below 1 000 W, then kW with 1 decimal; `step: 5` on the Live page; `unit: "W"` to stay in watts | « 407 W », « 1,1 kW »                               |
| Energy (value in kWh)                           | `formatEnergy`       | 3 significant digits, at most 2 decimals; `unit: "auto"` for Wh below 1 kWh                             | « 7,09 kWh », « 14,3 kWh », « 984 kWh »             |
| Percentage (0–100)                              | `formatPercent`      | 0 decimals                                                                                              | « 46 % »                                            |
| Euros                                           | `formatCurrency`     | 2 fixed decimals; `decimals` for a price per kWh                                                        | « 2,72 € »                                          |
| V, mbar, hPa, km/h, m/s, dB, lx, ppm, µg/m³, km | `formatWithUnit`     | 0 decimals                                                                                              | « 1 022 mbar »                                      |
| A, mm, mm/h                                     | `formatWithUnit`     | 1 decimal, trailing zero dropped                                                                        | « 0 A », « 0,4 mm »                                 |
| Unit the table does not know                    | `formatWithUnit`     | 1 decimal, trailing zero dropped, unit kept as given                                                    | « 3,2 xyz »                                         |
| Duration (seconds), unit `s`                    | `formatDuration`     | at most two units, seconds dropped above 10 min; `clock` for countdowns                                 | « 2 min 12 s », « 35 min », « 1 h 05 », « 3 j 4 h » |
| Size in bytes                                   | `formatBytes`        | 1 decimal; o, ko, Mo, Go in French                                                                      | « 5,9 Mo »                                          |
| Time ago                                        | `formatRelativeTime` | in the UI language; the date beyond a day                                                               | « il y a 12 min »                                   |
| Range                                           | `formatRange`        | en dash                                                                                                 | « 07:22 – 17:17 »                                   |

Trailing zeros are dropped everywhere except on temperatures (« 4 kWh », not « 4,0 kWh »). Each function takes `locale` (from `dateLocale(i18n.language)`, the default) and the `*Parts` variants return value and unit apart for layouts that style them differently. A translated sentence that carries a quantity receives it formatted, unit included (`{{power}}`, not `{{kw}} kW`).

#### Colour roles

Use the colour roles of `ui/src/index.css`, never a raw hue (`text-amber-500`, `text-red-500`) nor `text-accent`: each role means one thing, and the full table is in `design-system/tokens.md` §1.2.

- **Amber** (`bg-active`, `text-active-ink`, `bg-active-bg`, `text-on-active` on an amber fill): something on or running now. Never for alerts, energy, plugins or decoration.
- **Orange** (`bg-warning`, `text-warning-ink`): needs attention, not a fault. **Red** (`text-error`, `text-heat` for heating): fault, offline, destructive. **Green** (`text-success`): works as expected.
- **Neutral**: open and closed alike (the word and the icon say it), meters and energy values, plugins. **Primary**: selection, links, changed fields, motion.
- Text on a status fill is `text-on-status`, not `text-white`. Tinted status backgrounds stop at `/10`. Switches use `components/ui/Switch.tsx`.
- **Primary fill and primary ink are two roles.** A button, selected segment, checked box or switch that carries text or an icon is `bg-primary-fill text-white hover:bg-primary-fill-hover`; `bg-primary` (the ink, light blue in dark) is only for a dot, a bar or a line. Dashboard illustrations rest in `text-illu` and take the `--illu-*` tokens, never a hex or a filter.

`ui/src/lib/color-roles.test.ts` computes every role pair from `design-system/tokens.css` in light and dark (4.5:1 text, 3:1 graphics) and fails on a retired class name, because Tailwind 4 drops an unknown class without an error.

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

| Property           | Value                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| **Body font**      | Inter                                                                          |
| **Monospace font** | JetBrains Mono: logs, JSON, identifiers, versions, code                        |
| **Numbers**        | Inter with `tabular-nums` (fixed-width digits), not mono                       |
| **Labels**         | Sentence case; uppercase only in table column headers                          |
| **Primary color**  | `#1A4F6E` (ocean blue), hover: `#144159`, light: `#EEF5F8`                     |
| **Colour roles**   | Amber `#F2C035` = on or running only; others in `design-system/tokens.md` §1.2 |
| **Spacing base**   | 4px                                                                            |
| **Border radius**  | 6px (buttons), 10px (cards), 14px (modals)                                     |
| **Body font size** | 14px (dense dashboard)                                                         |
| **Data values**    | 28px (readable at a glance)                                                    |
| **Icons**          | Lucide React, stroke 1.5px                                                     |

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

## Private ops companion repo

The public `sowel` repository contains nothing specific to a given installation: no hosts, no IPs, no SSH targets, no credentials. Keep it that way in your contributions.

If you run your own Sowel deployment and want the developer tooling wired to it (dev/prod swap, shadow instance, docs screenshots, AI agent context), create your own **private** companion repository, by convention named `sowel-ops`, and clone it as a sibling of your `sowel` checkout:

```
workspace/
├── sowel/          # public repo (any clone name works)
└── sowel-ops/      # your private repo: hosts, SSH targets, agent context
```

It needs at most two files:

| File            | Purpose                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ops.env`       | Your hosts and SSH targets. Start from [`scripts/ops.env.example`](https://github.com/mchacher/sowel/blob/main/scripts/ops.env.example). Sourced automatically by `scripts/run-swap.sh` and `scripts/shadow-deploy.sh`. |
| `CLAUDE.ops.md` | Optional. Private context for AI coding agents (production topology, log access, safety rules). Imported by `CLAUDE.md` via `@../sowel-ops/CLAUDE.ops.md`.                                                              |

Both integration points degrade gracefully: without `sowel-ops`, the ops scripts refuse remote operations with a clear error and the `CLAUDE.md` import is simply skipped. Local development needs none of it.

Benefits: your installation details are versioned and backed up on GitHub (privately), while the public repository stays reusable by everyone.

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
