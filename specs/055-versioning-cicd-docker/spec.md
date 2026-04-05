# 055 — Versioning 1.0.0, CI/CD & Docker

## Summary

Establish Sowel 1.0.0. Set up multi-stage Dockerfile, GitHub Actions CI/CD pipeline for multi-arch Docker images on ghcr.io, production docker-compose.yml with InfluxDB auto-configured, and version endpoint.

## Version Strategy

- Semantic Versioning: MAJOR.MINOR.PATCH
- Source of truth: `package.json` version field
- Release flow: bump version → git tag vX.Y.Z → push tag → GitHub Actions builds + publishes

## Acceptance Criteria

- [ ] Version bumped to 1.0.0 (package.json + ui/package.json)
- [ ] `GET /api/v1/health` returns `version` field from package.json
- [ ] Multi-stage Dockerfile (node:20 build → node:20-slim runtime, ~150MB)
- [ ] GitHub Actions workflow: on tag push `v*`, CI checks + build multi-arch Docker image + push to ghcr.io + create GitHub release
- [ ] Docker image: `ghcr.io/mchacher/sowel:1.0.0` and `ghcr.io/mchacher/sowel:latest`
- [ ] Multi-arch: linux/amd64 + linux/arm64 (docker buildx)
- [ ] `docker-compose.yml` for end users: Sowel (ghcr.io image) + InfluxDB (auto-configured, shared token)
- [ ] `docker-compose.dev.yml` for development (local build)
- [ ] `.dockerignore` to keep image lean
- [ ] README updated with deployment instructions
- [ ] GitHub release with auto-generated changelog

## Dockerfile (multi-stage)

```dockerfile
# Stage 1: BUILD
FROM node:20 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN cd ui && npm ci && npm run build

# Stage 2: RUNTIME
FROM node:20-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/ui-dist ./ui-dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/plugins/registry.json ./plugins/registry.json
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

## docker-compose.yml (end user)

```yaml
services:
  sowel:
    image: ghcr.io/mchacher/sowel:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - INFLUX_URL=http://influxdb:8086
      - INFLUX_TOKEN=sowel-auto-token
      - INFLUX_ORG=sowel
      - INFLUX_BUCKET=sowel
    volumes:
      - sowel-data:/app/data
      - sowel-plugins:/app/plugins
    depends_on:
      - influxdb

  influxdb:
    image: influxdb:2.7
    restart: unless-stopped
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=sowel
      - DOCKER_INFLUXDB_INIT_PASSWORD=sowel-auto-password
      - DOCKER_INFLUXDB_INIT_ORG=sowel
      - DOCKER_INFLUXDB_INIT_BUCKET=sowel
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=sowel-auto-token
    volumes:
      - influxdb-data:/var/lib/influxdb2

volumes:
  sowel-data:
  sowel-plugins:
  influxdb-data:
```

## GitHub Actions (.github/workflows/release.yml)

```
on:
  push:
    tags: ["v*"]

jobs:
  release:
    steps:
      1. Checkout
      2. CI checks (typecheck, lint, test)
      3. Set up Docker Buildx
      4. Login to ghcr.io
      5. Build multi-arch image (amd64 + arm64)
      6. Push to ghcr.io with tags (version + latest)
      7. Create GitHub release with changelog
```

## Files Changed

| File                            | Change                                |
| ------------------------------- | ------------------------------------- |
| `package.json`                  | version → 1.0.0                       |
| `ui/package.json`               | version → 1.0.0                       |
| `src/api/routes/health.ts`      | Add version to response               |
| `Dockerfile`                    | NEW — multi-stage build               |
| `.dockerignore`                 | NEW                                   |
| `docker-compose.yml`            | NEW — production (ghcr.io + InfluxDB) |
| `docker-compose.dev.yml`        | NEW — development (local build)       |
| `.github/workflows/release.yml` | NEW — CI/CD pipeline                  |
| `README.md`                     | Update with deployment instructions   |
