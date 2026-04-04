# 055 — Versioning, CI/CD & Docker Images

## Summary

Establish Sowel 1.0.0, set up automated release pipeline with multi-arch Docker images on GitHub Container Registry. Production-ready `docker-compose.yml` for end users.

## Acceptance Criteria

- [ ] Version bumped to 1.0.0 (package.json + ui/package.json)
- [ ] `GET /api/v1/health` returns current version
- [ ] GitHub Actions workflow: on tag push, build multi-arch image + push to ghcr.io
- [ ] Docker image: `ghcr.io/mchacher/sowel:1.0.0` and `ghcr.io/mchacher/sowel:latest`
- [ ] Multi-arch: linux/amd64 + linux/arm64 (via docker buildx)
- [ ] Dockerfile optimized: no build toolchain (plugins are pre-built)
- [ ] docker-compose.yml for end users (ghcr.io image, not local build)
- [ ] docker-compose.dev.yml for development (local build)
- [ ] GitHub release with auto-generated changelog
- [ ] README with deployment instructions

## Docker Image

```
ghcr.io/mchacher/sowel:1.0.0
ghcr.io/mchacher/sowel:latest
```

Lightweight production image (~150MB):

- node:20-slim base
- Compiled backend (dist/)
- Built UI (ui-dist/)
- Migrations + recipe engine
- No: python3, make, g++, npm (plugins are pre-built)

## Release Flow

```
bump version → git tag v1.0.0 → push tag → GitHub Actions:
  1. CI checks (lint, typecheck, tests)
  2. Build multi-arch Docker image (buildx)
  3. Push to ghcr.io
  4. Create GitHub release with changelog
```

## docker-compose.yml (End User)

```yaml
services:
  sowel:
    image: ghcr.io/mchacher/sowel:latest
    ports: ["3000:3000"]
    volumes:
      - sowel-data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock # for self-update (055)
```
