# Sowel Feature Reference

## Key Files

| Purpose              | Location                                   |
| -------------------- | ------------------------------------------ |
| Full specification   | `docs/sowel-spec.md`                       |
| Feature specs        | `specs/XXX-feature-name/`                  |
| TypeScript types     | `src/shared/types.ts`                      |
| Constants            | `src/shared/constants.ts`                  |
| Event bus            | `src/core/event-bus.ts`                    |
| Database             | `src/core/database.ts`                     |
| Device manager       | `src/devices/device-manager.ts`            |
| Equipment manager    | `src/equipments/equipment-manager.ts`      |
| Zone manager         | `src/zones/zone-manager.ts`                |
| Zone aggregator      | `src/zones/zone-aggregator.ts`             |
| Recipe engine        | `src/recipes/engine/recipe-manager.ts`     |
| API server           | `src/api/server.ts`                        |
| WebSocket            | `src/api/websocket.ts`                     |
| API routes           | `src/api/routes/`                          |
| Plugin manager       | `src/plugins/plugin-manager.ts`            |
| Integration registry | `src/integrations/integration-registry.ts` |
| AI manager           | `src/ai/ai-manager.ts`                     |
| UI stores            | `ui/src/store/`                            |
| UI components        | `ui/src/components/`                       |
| UI pages             | `ui/src/pages/`                            |
| Migrations           | `migrations/`                              |
| Tailwind config      | `ui/tailwind.config.js`                    |

## Domain-Specific Files

| Domain       | Files to read                                         |
| ------------ | ----------------------------------------------------- |
| Devices      | `src/devices/`                                        |
| Equipments   | `src/equipments/`, bindings, computed engine          |
| Zones        | `src/zones/`, zone-aggregator                         |
| Scenarios    | `src/scenarios/`, trigger/condition/action evaluators |
| Recipes      | `src/recipes/engine/`, `src/recipes/*.ts`             |
| AI Assistant | `src/ai/`, prompt templates, providers                |
| API          | `src/api/routes/`, `src/api/server.ts`                |
| Auth         | `src/auth/`, middleware                               |
| Plugins      | `src/plugins/`, `plugins/`                            |
| UI           | `ui/src/components/`, `ui/src/store/`                 |
| Database     | `migrations/`, SQLite schema in spec section 8        |

## Commands

| Action             | Command                               |
| ------------------ | ------------------------------------- |
| Start engine       | `npm run dev`                         |
| Start UI           | `cd ui && npm run dev`                |
| Type check backend | `npx tsc --noEmit`                    |
| Type check UI      | `cd ui && npx tsc --noEmit`           |
| Run tests          | `cd /path/to/Sowel && npx vitest run` |
| Run single test    | `npx vitest run <file>`               |
| Lint               | `npx eslint src/ --ext .ts`           |
| Reset DB           | `rm data/sowel.db && npm run dev`     |

## Event-Driven Pipeline

```
Integration message (MQTT, cloud API poll, etc.)
  → Integration Plugin (receives + parses)
    → Device Manager (updates DeviceData)
      → Event Bus: "device.data.updated"
        → Equipment Manager (re-evaluates bindings + computed Data)
          → Event Bus: "equipment.data.changed"
            → Zone Manager (re-evaluates aggregations)
              → Event Bus: "zone.data.changed"
                → Scenario Engine (evaluates triggers → conditions → actions)
                  → Actions may emit Orders → Integration Plugin → device
            → WebSocket pushes to UI clients
```

## Spec Templates

### spec.md

```markdown
# Feature Name

## Summary

Brief description.

## Reference

- Spec sections: §X, §Y (reference sowel-spec.md sections)

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Scope

### In Scope

- Item 1

### Out of Scope

- What is NOT included

## Edge Cases

- Edge case 1
- Edge case 2
```

### architecture.md

```markdown
# Architecture: Feature Name

## Data Model Changes

- New SQLite tables / columns
- New types in types.ts

## Event Bus Events

- New events emitted / consumed

## API Changes

- New / changed endpoints

## UI Changes

- New components / store changes

## File Changes

| File                  | Change      |
| --------------------- | ----------- |
| `src/path/to/file.ts` | Description |
```

### plan.md

```markdown
# Implementation Plan: Feature Name

## Tasks

1. [ ] Task 1
2. [ ] Task 2

## Dependencies

- Requires spec XXX to be completed first

## Testing

- How to verify manually
```

## Commit Scopes

`mqtt`, `devices`, `equipments`, `zones`, `scenarios`, `recipes`, `ai`, `api`, `ws`, `ui`, `auth`, `db`, `core`, `plugins`, `backup`
