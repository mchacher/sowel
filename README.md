# Sowel

Home automation engine with a plugin-based architecture. Separates physical devices from user-facing equipments, provides automatic zone aggregation, a recipe-based automation engine, and a reactive web UI.

**Founded by Marc Chachereau** · AGPL-3.0 · [app.sowel.org](https://app.sowel.org)

## Quick Start

```bash
mkdir /opt/sowel && cd /opt/sowel
curl -O https://raw.githubusercontent.com/mchacher/sowel/main/docker-compose.yml
docker compose up -d
```

Open `http://<host>:3000` and create your admin account on first launch.

### Timezone

Sowel auto-derives the timezone from your home location (set `home.latitude`
and `home.longitude` in Settings → Home). This affects calendar slots,
HP/HC tariff classification, sunrise/sunset, and more.

To override explicitly (e.g. if you don't set a home location), uncomment
the `TZ` line in `docker-compose.yml`:

```yaml
environment:
  - TZ=Europe/Paris
```

Changing the home location at runtime requires a restart — Sowel shows a
"Restart now" toast in the UI to do it in one click.

See [docs/technical/deployment.md](docs/technical/deployment.md) for the full deployment guide (self-update, backup, troubleshooting).

## Key concepts

- **Devices** — auto-discovered from integration plugins
- **Equipments** — user-facing functional units with data bindings and order dispatch
- **Zones** — nestable spatial grouping with automatic aggregation (motion, temperature, energy…)
- **Recipes** — automation templates (motion-light, presence-thermostat, state-watch…)
- **Modes** — named zone-level states (Day/Night/Away) with impacts
- **Plugins** — integrations and recipes distributed from GitHub, installed from the built-in store

## Features

- 🔌 **Plugin ecosystem**: Zigbee2MQTT, Panasonic CC, MCZ Maestro, Legrand (Control + Energy), Netatmo Weather & Security, SmartThings, LoRa2MQTT, Weather Forecast
- 🏠 **Zone aggregation**: automatic rollup of equipment data up the zone tree
- 📅 **Calendar-driven modes**: schedule mode changes via cron slots (day/night/away)
- 🤖 **Recipe engine**: reusable automation templates with typed parameter slots
- ⚡ **Energy monitoring**: HP/HC tariff classification, daily/monthly aggregation, InfluxDB history
- 💾 **Backup & restore**: full system ZIP, auto pre-update backups, one-click restore
- 🔄 **Self-update**: update from the UI via Docker helper container (no CLI needed)
- 📱 **PWA**: installable on mobile, offline-aware, responsive
- 🌍 **i18n**: French and English

## Tech stack

| Layer          | Technology                                                 |
| -------------- | ---------------------------------------------------------- |
| Backend        | Node.js 20+ / TypeScript / Fastify / SQLite / InfluxDB 2.x |
| Frontend       | React 18+ / TypeScript / Vite / Tailwind CSS / Zustand     |
| Infrastructure | Docker / GitHub Container Registry                         |
| Logging        | pino (ring buffer + rotating files)                        |

## Documentation

- [Architecture](docs/technical/architecture.md) — system design, plugin system, self-update, backup, logging
- [Deployment](docs/technical/deployment.md) — install, update, backup/restore, troubleshooting
- [API Reference](docs/technical/api-reference.md) — REST and WebSocket
- [Plugin Development](docs/technical/plugin-development.md) — how to build a plugin
- [Recipe Development](docs/technical/recipe-development.md) — how to build a recipe
- [Data Model](docs/technical/data-model.md) — SQLite schema and types
- [Specs Index](docs/specs-index.md) — chronological index of every spec

User guides in [docs/user/](docs/user/).

## Development

```bash
# Backend
npm install
npm run dev

# Frontend (separate terminal)
cd ui && npm install && npm run dev

# Run tests
npx vitest run

# Full validation (typecheck + lint + tests, backend + UI)
npm run validate
```

## Release

Releases are tagged on `main` via `scripts/release.sh <version>`. GitHub Actions builds the Docker image and pushes it to `ghcr.io/mchacher/sowel:<version>`.

```bash
scripts/release.sh 1.1.0
```

## License

[AGPL-3.0](LICENSE)
