---
name: sowel-feature
description: |
  Creates features for Sowel — a home automation engine. Use when:
  - User asks to "create a feature", "implement X", "add VX.Y" for Sowel
  - Working on a roadmap version (V0.1, V0.2, etc.)
  - User says "créer une feature", "ajouter une fonctionnalité", "implémenter"
  Specific to Sowel project: MQTT, devices, equipments, zones, scenarios, recipes, AI assistant.
---

# Sowel Feature Workflow

## Phase 1: Understand & Clarify

### 1.1 Read Essential Documentation

Before starting, read these files:

| Document                  | Purpose                                         |
| ------------------------- | ----------------------------------------------- |
| `docs/sowel-spec.md`      | Full specification — the single source of truth |
| `src/shared/types.ts`     | All TypeScript types and interfaces             |
| `src/shared/constants.ts` | DataCategory mappings, EquipmentType, etc.      |
| `CLAUDE.md`               | Project conventions and rules                   |

If the feature involves a specific domain, also read:

| Domain         | Files to read                                         |
| -------------- | ----------------------------------------------------- |
| MQTT / Devices | `src/mqtt/`, `src/devices/`                           |
| Equipments     | `src/equipments/`, bindings, computed engine          |
| Zones          | `src/zones/`, zone-aggregator                         |
| Scenarios      | `src/scenarios/`, trigger/condition/action evaluators |
| Recipes        | `src/scenarios/recipe-manager.ts`, `recipes/*.json`   |
| AI Assistant   | `src/ai/`, prompt templates, providers                |
| API            | `src/api/routes/`, `src/api/server.ts`                |
| Auth           | `src/auth/`, middleware                               |
| UI             | `ui/src/components/`, `ui/src/store/`                 |
| Database       | `migrations/`, SQLite schema in spec section 8        |

### 1.2 Deep-Dive Requirements

**IMPORTANT**: Do not assume. Ask clarifying questions until requirements are crystal clear.

Ask the user about:

| Topic          | Questions to ask                                                           |
| -------------- | -------------------------------------------------------------------------- |
| **What**       | Describe the feature in 2-3 sentences. What is the expected behavior?      |
| **Why**        | What problem does it solve? Which user benefits?                           |
| **Roadmap**    | Which version (V0.1–V1.3) does this belong to? What does the spec say?     |
| **Scope**      | What's included? What's explicitly excluded?                               |
| **Data model** | New entities? New fields? Changes to SQLite schema? Changes to types.ts?   |
| **Events**     | New event bus events? Which existing events are consumed?                  |
| **API**        | New REST endpoints? Changes to WebSocket messages?                         |
| **MQTT**       | New topics to subscribe to? New messages to publish?                       |
| **UI**         | New pages? New components? Changes to existing views?                      |
| **Edge cases** | What happens with null data? Device offline? Empty zones? MQTT disconnect? |

**Continue asking until you can write a complete spec without assumptions.**
**Ask user if they have any other inputs, and if any, redo 1.2**

### 1.3 Check Existing Patterns

```bash
# Check existing implementations for similar patterns
ls src/ | head -20
grep -r "<keyword>" src/shared/types.ts
grep -r "<keyword>" src/api/routes/
ls ui/src/components/ | grep -i <keyword>
```

---

## Phase 2: Document the Spec

Every feature MUST be documented in `specs/`. Use English only.

### 2.1 Create Spec Folder

```bash
ls specs/ | tail -1  # Find last number
mkdir specs/XXX-<version>-<feature-name>
```

**Convention**: `XXX-<version>-<feature-name>`

- `XXX`: Sequential 3-digit number
- `<version>`: Roadmap version (e.g., `V0.1`, `V0.3`)
- `<feature-name>`: Kebab-case name

Example: `001-V0.1-mqtt-devices`, `005-V0.3-zone-aggregation`

### 2.2 Create Spec Files

| File              | Content                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `spec.md`         | Requirements, acceptance criteria, edge cases                                 |
| `architecture.md` | Technical design: data model changes, event flow, API contracts, file changes |
| `plan.md`         | Implementation steps, task breakdown                                          |

### 2.3 Templates

**spec.md**:

```markdown
# V0.X: Feature Name

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

- What is NOT included (deferred to later version)

## Edge Cases

- What happens when MQTT disconnects mid-discovery?
- What happens when a Device goes offline?
- What happens when a Zone has no Equipments?
```

**architecture.md**:

```markdown
# Architecture: V0.X Feature Name

## Data Model Changes

- New SQLite tables / columns
- New types in types.ts

## Event Bus Events

- New events emitted
- Events consumed

## MQTT Topics

- Topics subscribed
- Messages published

## API Changes

- New endpoints
- Changed endpoints

## UI Changes

- New components
- Store changes

## File Changes

| File                  | Change      |
| --------------------- | ----------- |
| `src/path/to/file.ts` | Description |
```

**plan.md**:

```markdown
# Implementation Plan: V0.X Feature Name

## Tasks

1. [ ] Task 1
2. [ ] Task 2

## Dependencies

- Requires V0.X to be completed first

## Testing

- How to verify manually (with real MQTT / zigbee2mqtt)
```

---

## Phase 2b: User Validation (REQUIRED)

**CRITICAL**: Do NOT proceed to implementation without explicit user approval.

### 2b.1 Present Spec Summary

After writing the spec, present a summary to the user:

```
## Résumé de la spécification

**Feature**: [Name] (V0.X)
**Scope**: [In scope items]
**Data Model**: [New tables/fields]
**Events**: [New event bus events]
**API**: [New endpoints]
**MQTT**: [Topics involved]
**UI**: [New/changed views]

Voulez-vous que j'implémente cette feature ?
```

### 2b.2 Wait for Approval

- If user says "oui" / "yes" / "go" → proceed to Phase 3
- If user has questions or changes → update spec and re-present
- If user says "non" / "attends" → stop and clarify

---

## Phase 3: Branch & Implement

### 3.1 Create Feature Branch

```bash
git checkout main
git pull
git checkout -b feat/<version>-<feature-name>
```

Examples: `feat/v0.1-mqtt-devices`, `feat/v0.3-zone-aggregation`

**Prefixes**: `feat/`, `fix/`, `refactor/`, `docs/`

### 3.2 Implement in Order

Follow this strict order to avoid broken dependencies:

#### 1. Types first

- Update `src/shared/types.ts` with new interfaces, enums, event types
- Update `src/shared/constants.ts` if needed (DataCategory, EquipmentType, etc.)

#### 2. Database changes

- Create migration in `migrations/` (sequential numbering: `001-init.sql`, `002-equipments.sql`)
- Update database initialization in `src/core/database.ts`

#### 3. Core / Event Bus

- Add new event types to the typed EventEmitter
- Wire up event handlers

#### 4. Domain logic (backend)

- MQTT handlers (`src/mqtt/`)
- Device/Equipment/Zone/Scenario managers
- Follow the event-driven pipeline: MQTT → Device → Equipment → Zone → Scenario

#### 5. API routes

- Add routes in `src/api/routes/`
- Register in `src/api/server.ts`
- Use JSON Schema validation on request bodies (Fastify native)

#### 6. WebSocket

- Add new event types to WebSocket broadcast in `src/api/websocket.ts`

#### 7. UI (if applicable for this version)

- Zustand store updates in `ui/src/store/`
- Components in `ui/src/components/`
- Pages in `ui/src/pages/`
- Follow design system from spec §15

### 3.3 Implementation Rules

**MUST follow these rules (non-negotiable):**

| Rule               | Detail                                                   |
| ------------------ | -------------------------------------------------------- |
| TypeScript strict  | `strict: true`, no `any` type                            |
| UUID for IDs       | `crypto.randomUUID()` for all entity IDs                 |
| Types in types.ts  | All interfaces in `src/shared/types.ts`                  |
| No eval            | Safe expression parser for computed data, never `eval()` |
| MQTT never throws  | All MQTT handlers wrapped in try/catch with logging      |
| Events never throw | All event handlers wrapped in try/catch with logging     |
| SQLite synchronous | Use `better-sqlite3` sync API, WAL mode                  |
| Pino logging       | Use structured pino logger, follow log level strategy    |
| No console.\*      | Never use `console.log/error/warn` — always pino logger  |
| Tailwind only      | No custom CSS files in UI, utility classes only          |
| CSS variables      | Use design system tokens from tailwind.config.js         |
| Lucide icons       | Use lucide-react for all icons                           |

### 3.4 Logging Rules (MANDATORY)

Every new module or feature MUST follow the logging strategy defined in `CLAUDE.md § Logging`.

#### Logger Setup

```typescript
// In a class — create child logger with module context
constructor(deps: { logger: Logger }) {
  this.logger = deps.logger.child({ module: "my-module" });
}

// In a standalone function
const logger = parentLogger.child({ module: "my-module" });
```

- Property name: `this.logger` in classes, `logger` in functions. Never `this.log` or `log`.

#### Level Assignment Checklist

When adding log calls, verify each one against this table:

| Level     | Use for                                            | NOT for                                       |
| --------- | -------------------------------------------------- | --------------------------------------------- |
| **fatal** | Process crash, unrecoverable state                 | Recoverable errors                            |
| **error** | Operation failed, needs attention                  | Expected failures (e.g., 404, invalid input)  |
| **warn**  | Self-recovered issue, degradation signal           | Normal operations, business events            |
| **info**  | One log per business operation (CRUD, connect)     | Per-item details, per-message, per-data-point |
| **debug** | Troubleshooting details, step-by-step trace        | Hot-path data that fires every second         |
| **trace** | Every event emission, every MQTT msg, every update | Anything that should be visible in production |

#### Structured Context

```typescript
// GOOD — structured context as first arg, message as second
logger.info({ deviceId, status }, "Device status changed");
logger.error({ err, integrationId }, "Poll failed");

// BAD — string interpolation
logger.info(`Device ${deviceId} changed to ${status}`);
logger.error(`Poll failed: ${err.message}`);
```

#### Domain-Specific Guidelines

| Domain       | info                                   | debug                                | trace                     |
| ------------ | -------------------------------------- | ------------------------------------ | ------------------------- |
| MQTT         | Connected/disconnected/reconnecting    | Topic subscribed, publish result     | Every message received    |
| Devices      | Discovered, removed, status changed    | Data auto-created, category inferred | Every data point update   |
| Equipments   | CRUD, order dispatched                 | Binding evaluation, computed result  | Every binding re-eval     |
| Zones        | CRUD, aggregation summary              | Individual fields computed           | Every aggregation trigger |
| Modes        | Activated/deactivated, CRUD            | Each impact action executed          | —                         |
| Recipes      | Instance CRUD, enabled/disabled        | Execution steps, trigger evaluation  | —                         |
| Integrations | Started/stopped, poll completed        | Poll cycle details, API call results | Raw API responses         |
| Auth         | Login, token created, password changed | JWT validation, middleware decisions | —                         |
| API          | Server listening                       | Request handling details             | Every request/response    |
| WebSocket    | Client connected/disconnected          | Topic subscription                   | Every frame               |
| Event Bus    | —                                      | —                                    | Every event emitted       |

---

## Phase 4: Test & Validate

### 4.1 TypeScript Compilation

**CRITICAL**: Run build BEFORE committing.

```bash
# Backend
npx tsc --noEmit

# Frontend (if UI changes)
cd ui && npx tsc --noEmit
```

**Build must pass with ZERO type errors.**

### 4.2 Run Tests

```bash
npm run test
```

**All tests must pass.**

### 4.3 Manual Verification

For each version, verify with real infrastructure:

| Version | How to verify                                                                     |
| ------- | --------------------------------------------------------------------------------- |
| V0.1    | Connect to zigbee2mqtt, check devices appear in `GET /api/v1/devices`             |
| V0.2    | Create an Equipment via API, bind to Device, execute an Order, check MQTT publish |
| V0.3    | Create Zone with Equipments, trigger motion, check `zone.motion` aggregation      |
| V0.4    | Open UI, see live dashboard, control Equipment from browser                       |
| V0.5    | Create computed Data expression, verify it updates on source change               |
| V0.6    | Check InfluxDB writes, view charts in UI                                          |
| V0.7    | Create Scenario with trigger/condition/action, verify it fires                    |
| V0.8    | Instantiate a Recipe, verify resulting Scenario works                             |
| V0.9+   | Full integration test with Docker                                                 |

### 4.4 Lint

```bash
npx eslint src/ --ext .ts
cd ui && npx eslint src/ --ext .ts,.tsx
```

---

## Phase 5: Documentation & Commit

### 5.1 Update Documentation

Before final commit, update:

| Document                           | What to update                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `docs/sowel-spec.md`               | Mark completed items, add any spec clarifications discovered during implementation |
| `specs/XXX-<version>-name/plan.md` | Mark tasks as completed [x]                                                        |
| `specs/XXX-<version>-name/spec.md` | Mark acceptance criteria as completed [x]                                          |
| `CLAUDE.md`                        | Add new commands, patterns, or conventions discovered                              |

### 5.2 Commit Changes

Commit incrementally as you implement. Use conventional commits:

```bash
git add -A
git commit -m "feat(scope): description

Explanation of what and why.
Refs: V0.X

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <model>.<version> <noreply@anthropic.com>"
```

**Scopes**: `mqtt`, `devices`, `equipments`, `zones`, `scenarios`, `recipes`, `ai`, `api`, `ws`, `ui`, `auth`, `db`, `core`

---

## Phase 6: Pull Request & Merge

### 6.1 Push Branch

```bash
git push -u origin feat/<version>-<feature-name>
```

### 6.2 Create Pull Request

```bash
gh pr create --title "feat: V0.X — feature description" --body "$(cat <<'EOF'
## Summary
- What was implemented

## Changes
- Backend: ...
- API: ...
- UI: ...
- Database: ...

## Test plan
- [x] TypeScript compiles (zero errors)
- [x] All tests pass
- [x] Manually verified with real MQTT/zigbee2mqtt
- [x] Spec acceptance criteria all checked

## Roadmap
- Implements V0.X from sowel-spec.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 6.3 Wait for User Approval

**Do NOT merge without user confirmation.**

Ask: "PR créée: [URL]. Voulez-vous que je merge dans main ?"

### 6.4 Merge & Cleanup

Once user approves:

```bash
gh pr merge <number> --merge --delete-branch
git checkout main
git pull
```

---

## Quick Reference

### Key Files

| Purpose            | Location                              |
| ------------------ | ------------------------------------- |
| Full specification | `docs/sowel-spec.md`                  |
| Feature specs      | `specs/XXX-version-name/`             |
| TypeScript types   | `src/shared/types.ts`                 |
| Constants          | `src/shared/constants.ts`             |
| Event bus          | `src/core/event-bus.ts`               |
| Database           | `src/core/database.ts`                |
| MQTT connector     | `src/mqtt/connector.ts`               |
| z2m parser         | `src/mqtt/parsers/zigbee2mqtt.ts`     |
| Device manager     | `src/devices/device-manager.ts`       |
| Equipment manager  | `src/equipments/equipment-manager.ts` |
| Zone manager       | `src/zones/zone-manager.ts`           |
| Zone aggregator    | `src/zones/zone-aggregator.ts`        |
| Scenario engine    | `src/scenarios/scenario-engine.ts`    |
| API server         | `src/api/server.ts`                   |
| WebSocket          | `src/api/websocket.ts`                |
| API routes         | `src/api/routes/`                     |
| AI manager         | `src/ai/ai-manager.ts`                |
| UI stores          | `ui/src/store/`                       |
| UI components      | `ui/src/components/`                  |
| UI pages           | `ui/src/pages/`                       |
| Migrations         | `migrations/`                         |
| Recipes            | `recipes/*.json`                      |
| Tailwind config    | `ui/tailwind.config.js`               |

### Commands

| Action             | Command                           |
| ------------------ | --------------------------------- |
| Start engine       | `npm run dev`                     |
| Start UI           | `cd ui && npm run dev`            |
| Type check backend | `npx tsc --noEmit`                |
| Type check UI      | `cd ui && npx tsc --noEmit`       |
| Run tests          | `npm run test`                    |
| Run single test    | `npx vitest run <file>`           |
| Lint               | `npx eslint src/ --ext .ts`       |
| Reset DB           | `rm data/sowel.db && npm run dev` |

### Event-Driven Pipeline

Always remember the data flow:

```
MQTT message
  → src/mqtt/connector.ts (receives)
  → src/mqtt/parsers/zigbee2mqtt.ts (parses)
  → src/devices/device-manager.ts (updates DeviceData)
  → EventBus: "device.data.changed"
  → src/equipments/equipment-manager.ts (updates bound Equipment Data)
  → EventBus: "equipment.data.changed"
  → src/zones/zone-aggregator.ts (recomputes Zone aggregations)
  → EventBus: "zone.data.changed"
  → src/scenarios/scenario-engine.ts (evaluates triggers)
  → Actions execute → Orders publish to MQTT
  → src/api/websocket.ts (broadcasts all events to connected clients)
```

### Checklist

- [ ] Requirements clarified with user (Phase 1)
- [ ] Spec written in `specs/XXX-version-name/` (Phase 2)
- [ ] **User approved spec before implementation** (Phase 2b)
- [ ] Types defined in `types.ts` first
- [ ] Migrations created for DB changes
- [ ] Event bus events typed and wired
- [ ] **TypeScript compiles with zero errors** (Phase 4.1)
- [ ] All tests pass (Phase 4.2)
- [ ] Manually verified with real MQTT (Phase 4.3)
- [ ] Lint passes (Phase 4.4)
- [ ] Documentation updated (Phase 5.1)
- [ ] PR created with summary (Phase 6.2)
- [ ] **User approved PR before merge** (Phase 6.3)
- [ ] Merged to main
- [ ] Branch deleted
