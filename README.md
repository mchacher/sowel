# Sowel

Home automation engine. Pick a **Recipe**, apply it to a **Zone** — your house just works. No YAML, no scripts.

**Founded by Marc Chachereau** · AGPL-3.0

## Quick start

One command. Requires Docker:

```bash
curl -fsSL https://raw.githubusercontent.com/mchacher/sowel/main/scripts/install.sh | sh
```

Sowel installs into `~/sowel/` (override with `SOWEL_DIR=/your/path`), starts on port 3000 (override with `SOWEL_PORT=...`), and prints the URL when ready. Open it and create your admin account.

<details>
<summary>Manual install (skip the script)</summary>

```bash
mkdir ~/sowel && cd ~/sowel
curl -O https://raw.githubusercontent.com/mchacher/sowel/main/docker-compose.yml
docker compose up -d
```

</details>

See [docs/technical/deployment.md](docs/technical/deployment.md) for self-update, backup, timezone and troubleshooting.

## Concepts

- **Devices** — auto-discovered from integration plugins
- **Equipments** — user-facing functional units bound to one or more devices
- **Zones** — nestable spatial tree with automatic data aggregation
- **Recipes** — automation templates with typed parameter slots
- **Modes** — named zone-level states (Day/Night/Away)
- **Plugins** — integrations and recipes distributed from GitHub, installed from the in-app store

## Tech stack

Node.js 24+ / TypeScript / Fastify / SQLite / InfluxDB 2.x · React 18 / Vite / Tailwind / Zustand · Docker / GHCR · pino.

## Documentation

- [Architecture](docs/technical/architecture.md)
- [Deployment](docs/technical/deployment.md)
- [API Reference](docs/technical/api-reference.md)
- [Plugin Development](docs/technical/plugin-development.md) · [Recipe Development](docs/technical/recipe-development.md)
- [Data Model](docs/technical/data-model.md) · [Specs Index](docs/specs-index.md)

User guides: [docs/user/](docs/user/).

## Development

```bash
npm install && npm run dev          # backend
cd ui && npm install && npm run dev # frontend (separate terminal)
npm run validate                    # typecheck + lint + tests (backend + UI)
```

## Release

```bash
scripts/release.sh 1.5.10
```

GitHub Actions builds and publishes `ghcr.io/mchacher/sowel:<version>`.

## License

[AGPL-3.0](LICENSE)
