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

## Commands, reactive pipeline, commit scopes

In `CLAUDE.md` ("Build & run commands", "Reactive pipeline", "Git workflow"). Not repeated here.

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

## Docs Delta

| Page (EN and FR)                      | Change                    |
| ------------------------------------- | ------------------------- |
| `docs/user/<page>.md` + `.fr.md`      | What the reader now sees  |
| `docs/technical/<page>.md` + `.fr.md` | New endpoint, field, flow |

Screenshots to retake: ...

Or: `Docs-Impact: none — <why nothing a reader can observe changed>`
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

## Test Plan

| Module | Scenario | Expected |
| ------ | -------- | -------- |

## Validation Plan

- `npm run validate`
- Docs and spec checks (skill, Phase 4)
- Manual tests
```

## Production deployment

Installation-specific facts (host, SSH target, credentials pointer) live in the private companion repo `../sowel-ops/` (see `CLAUDE.md`, section "Installation-specific context"). See [docs/technical/deployment.md](../../../docs/technical/deployment.md) for the generic operations guide.

- Log files on the host: `docker exec sowel cat /app/data/logs/sowel.N.log`
