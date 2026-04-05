# Sowel

Home automation engine with a plugin-based architecture. Separates physical devices from user-facing equipments, provides automatic zone aggregation, a recipe-based automation engine, and a reactive web UI.

**Founded by Marc Chachereau** | AGPL-3.0

## Quick Start (Docker)

```bash
curl -O https://raw.githubusercontent.com/mchacher/sowel/main/docker-compose.yml
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and create your admin account.

## Architecture

- **Devices** -- auto-discovered from integration plugins (Zigbee2MQTT, Panasonic CC, Netatmo, etc.)
- **Equipments** -- user-facing functional units with data bindings and order dispatch
- **Zones** -- spatial grouping with automatic aggregation (motion, temperature, etc.)
- **Recipes** -- automation templates (motion-light, presence-thermostat, state-watch, etc.)
- **Plugins** -- external packages for integrations and recipes, installed from the built-in store

## Tech Stack

| Layer          | Technology                                                 |
| -------------- | ---------------------------------------------------------- |
| Backend        | Node.js 20+ / TypeScript / Fastify / SQLite / InfluxDB 2.x |
| Frontend       | React 18+ / TypeScript / Vite / Tailwind CSS / Zustand     |
| Infrastructure | Docker / GitHub Container Registry                         |

## Development

```bash
# Backend
npm install
npm run dev

# Frontend
cd ui && npm install && npm run dev

# Docker (local build)
docker compose -f docker-compose.dev.yml up -d --build
```

## License

[AGPL-3.0](LICENSE)
