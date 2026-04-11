# Sowel Feature Reference

Quick reference for the `sowel-feature` skill. For the full workflow, see [SKILL.md](SKILL.md).

## Where to find things

| Topic                     | File                              |
| ------------------------- | --------------------------------- |
| **AI agent entry point**  | `CLAUDE.md`                       |
| **Current architecture**  | `docs/technical/architecture.md`  |
| **Specs index (chrono)**  | `docs/specs-index.md`             |
| **Production operations** | `docs/technical/deployment.md`    |
| **Data model**            | `docs/technical/data-model.md`    |
| **API reference**         | `docs/technical/api-reference.md` |
| **Feature specs**         | `specs/XXX-feature-name/`         |
| **TypeScript types**      | `src/shared/types.ts`             |
| **Constants**             | `src/shared/constants.ts`         |

## Core backend services

| Service                       | File                           |
| ----------------------------- | ------------------------------ |
| Event bus                     | `src/core/event-bus.ts`        |
| Database                      | `src/core/database.ts`         |
| Settings manager              | `src/core/settings-manager.ts` |
| Version checker (update poll) | `src/core/version-checker.ts`  |
| Update manager (self-update)  | `src/core/update-manager.ts`   |
| Influx client                 | `src/core/influx-client.ts`    |
| Logger                        | `src/core/logger.ts`           |
| Backup manager                | `src/backup/backup-manager.ts` |

## Plugin system (spec 053+)

| Service                               | File                                       |
| ------------------------------------- | ------------------------------------------ |
| Package manager (GitHub distribution) | `src/packages/package-manager.ts`          |
| Plugin loader (integrations)          | `src/plugins/plugin-loader.ts`             |
| Recipe loader (recipes)               | `src/recipes/recipe-loader.ts`             |
| Integration registry (runtime)        | `src/integrations/integration-registry.ts` |
| Plugin API types                      | `src/shared/plugin-api.ts`                 |
| Plugin registry (source of truth)     | `plugins/registry.json`                    |

**Everything is a plugin now**. There are no built-in integrations or recipes in `src/`. See [docs/technical/architecture.md § Plugin Architecture V2](../../../docs/technical/architecture.md#plugin-architecture-v2-current).

## Domain managers

| Manager               | File                                   |
| --------------------- | -------------------------------------- |
| Device manager        | `src/devices/device-manager.ts`        |
| Equipment manager     | `src/equipments/equipment-manager.ts`  |
| Zone manager          | `src/zones/zone-manager.ts`            |
| Zone aggregator       | `src/zones/zone-aggregator.ts`         |
| Sunlight manager      | `src/zones/sunlight-manager.ts`        |
| Mode manager          | `src/modes/mode-manager.ts`            |
| Calendar manager      | `src/modes/calendar-manager.ts`        |
| Recipe engine         | `src/recipes/engine/recipe-manager.ts` |
| Button action manager | `src/buttons/button-action-manager.ts` |
| Energy aggregator     | `src/energy/energy-aggregator.ts`      |
| Tariff classifier     | `src/energy/tariff-classifier.ts`      |
| History writer        | `src/history/history-writer.ts`        |
| Auth service          | `src/auth/auth-service.ts`             |
| User manager          | `src/auth/user-manager.ts`             |

## API

| Part                                | File                          |
| ----------------------------------- | ----------------------------- |
| Server setup + route registration   | `src/api/server.ts`           |
| WebSocket handler + event broadcast | `src/api/websocket.ts`        |
| Individual routes                   | `src/api/routes/<domain>.ts`  |
| Auth middleware                     | `src/auth/auth-middleware.ts` |

## Frontend

| Part                 | File                               |
| -------------------- | ---------------------------------- |
| Zustand stores       | `ui/src/store/`                    |
| Components by domain | `ui/src/components/<domain>/`      |
| Pages                | `ui/src/pages/`                    |
| API client           | `ui/src/api.ts`                    |
| Types                | `ui/src/types.ts`                  |
| i18n locales         | `ui/src/i18n/locales/{en,fr}.json` |

## Commands

| Action             | Command                           |
| ------------------ | --------------------------------- |
| Start engine (dev) | `npm run dev`                     |
| Start UI (dev)     | `cd ui && npm run dev`            |
| Type check backend | `npx tsc --noEmit`                |
| Type check UI      | `cd ui && npx tsc -b --noEmit`    |
| Run tests          | `npx vitest run`                  |
| Run single test    | `npx vitest run <file>`           |
| Lint backend       | `npx eslint src/ --ext .ts`       |
| Lint UI            | `cd ui && npx eslint .`           |
| Full validate      | `npm run validate`                |
| Reset DB           | `rm data/sowel.db && npm run dev` |
| Release            | `scripts/release.sh <version>`    |

## Reactive pipeline

```
Integration message (MQTT, cloud API poll, etc.)
  → Integration Plugin (receives + parses)
    → Device Manager (updates DeviceData)
      → Event Bus: "device.data.updated"
        → Equipment Manager (re-evaluates bindings + computed Data)
          → Event Bus: "equipment.data.changed"
            → Zone Manager (re-evaluates aggregations)
              → Event Bus: "zone.data.changed"
                → Recipe Engine (evaluates triggers → conditions → actions)
                  → Actions may emit Orders → Integration Plugin → device
            → WebSocket pushes to UI clients
```

## Spec templates

### spec.md

```markdown
# Spec XXX — Feature Name

## Context

Why this feature exists, what problem it solves.

## Goals

1. Goal 1
2. Goal 2

## Non-Goals

- What is explicitly NOT included

## Functional Requirements

### FR1 — Name

Description, behavior, data flow.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Edge Cases

- Edge case 1
```

### architecture.md

```markdown
# Architecture — Spec XXX

## Flow diagram
```

[ascii diagram of the flow]

```

## Components

### New: `src/path/to/new-file.ts`

Description.

## Files changed

| Domain | File | Change |
| --- | --- | --- |
| Core | `src/core/foo.ts` | Added bar |
```

### plan.md

```markdown
# Implementation Plan — Spec XXX

## Slices

### Slice A — Foundation

- A.1 — Create X
- A.2 — Refactor Y

### Slice B — Feature

- B.1 — Implement Z

## Validation Plan

- Typecheck, lint, tests
- Manual tests
```

## Commit scopes

`mqtt`, `devices`, `equipments`, `zones`, `recipes`, `modes`, `api`, `ws`, `ui`, `auth`, `db`, `core`, `plugins`, `packages`, `backup`, `self-update`, `energy`, `logging`, `docs`.

## Production deployment

Sowel production runs on Linux VM `sowelox` at `192.168.0.230:3000` (public: `https://app.sowel.org`). See [docs/technical/deployment.md](../../../docs/technical/deployment.md) for full operations guide.

- SSH access: `ssh mchacher@192.168.0.230` (key-based, no password)
- Log files: `docker exec sowel cat /app/data/logs/sowel.N.log`
- Credentials: memory file `reference_sowel_access.md`
