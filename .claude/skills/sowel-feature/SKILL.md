---
name: sowel-feature
description: |
  Creates features for Sowel — a home automation engine. Use when:
  - User asks to "create a feature", "implement X", "add VX.Y" for Sowel
  - Working on a roadmap version (V0.1, V0.2, etc.)
  - User says "créer une feature", "ajouter une fonctionnalité", "implémenter"
  Specific to Sowel project: MQTT, devices, equipments, zones, scenarios, recipes, AI assistant.
disable-model-invocation: true
argument-hint: "[description de la feature]"
---

# Sowel Feature Workflow

Feature request: $ARGUMENTS

Follow EVERY phase below IN ORDER. Each phase has a GATE — a condition that MUST be met before proceeding. Do NOT skip gates. Do NOT combine phases.

All conventions (logging, implementation rules, design system) are in `CLAUDE.md` — read it, do not duplicate here. For key files and commands, see [reference.md](reference.md).

---

## Phase 1: Understand & Clarify

### 1.1 Read Essential Documentation

Before starting, read these files IN ORDER:

| Document                         | Purpose                                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `CLAUDE.md`                      | AI agent entry point — conventions, rules, refs              |
| `docs/technical/architecture.md` | Current architecture (plugin V2, self-update, backup, CI/CD) |
| `docs/specs-index.md`            | Scan for related specs — there may already be a design       |
| `src/shared/types.ts`            | All TypeScript interfaces                                    |
| `src/shared/constants.ts`        | DataCategory, EquipmentType, etc.                            |

**Do NOT read `docs/sowel-spec.md`** — it's legacy and outdated.

If the feature involves a specific domain, also read the relevant source files (see [reference.md](reference.md) for the full list). When in doubt about history, check the spec files in `specs/XXX-*/` for the relevant feature.

### 1.2 Deep-Dive Requirements

**Do not assume. Ask clarifying questions until requirements are crystal clear.**

Ask the user about:

| Topic          | Questions to ask                                                         |
| -------------- | ------------------------------------------------------------------------ |
| **What**       | Describe the feature in 2-3 sentences. What is the expected behavior?    |
| **Why**        | What problem does it solve? Which user benefits?                         |
| **Scope**      | What's included? What's explicitly excluded?                             |
| **Data model** | New entities? New fields? Changes to SQLite schema? Changes to types.ts? |
| **Events**     | New event bus events? Which existing events are consumed?                |
| **API**        | New REST endpoints? Changes to WebSocket messages?                       |
| **UI**         | New pages? New components? Changes to existing views?                    |
| **Edge cases** | What happens with null data? Device offline? Empty zones?                |

**Continue asking until you can write a complete spec without assumptions.**
Ask user if they have any other inputs. If yes, ask more questions.

### 1.3 Check Existing Patterns

Search the codebase for similar patterns before designing the solution.

> **GATE 1**: Requirements are crystal clear. You can describe the feature without any open questions. Do NOT proceed until this is true.

---

## Phase 2: Document the Spec

Every feature MUST be documented in `specs/`. Use English only.

### 2.1 Create Spec Folder

```bash
ls specs/ | tail -1  # Find last number
mkdir specs/XXX-<feature-name>
```

Convention: `XXX-<feature-name>` — sequential 3-digit number + kebab-case name.

### 2.2 Write Spec Files

| File              | Content                                              |
| ----------------- | ---------------------------------------------------- |
| `spec.md`         | Requirements, acceptance criteria, scope, edge cases |
| `architecture.md` | Data model, event flow, API contracts, file changes  |
| `plan.md`         | Implementation steps, task breakdown, **test plan**  |

Use the templates in [reference.md](reference.md).

### 2.3 Write Test Plan (in `plan.md`)

The test plan is written BEFORE implementation, as a dedicated section in `plan.md`. It forces you to think about what to verify before writing code.

```markdown
## Test Plan

### Modules to test

- List each module that contains new or changed business logic

### Scenarios per module

For each module, list:

- **Nominal cases**: the happy path works as expected
- **Edge cases**: null data, empty inputs, boundary values
- **Retro-compat**: existing behavior is preserved (if refactoring)

### Example

| Module            | Scenario                           | Expected                                                 |
| ----------------- | ---------------------------------- | -------------------------------------------------------- |
| equipment-manager | Zone order dispatches to v2 plugin | executeOrder called with (device, orderKey, value)       |
| equipment-manager | Zone order dispatches to v1 plugin | executeOrder called with (device, dispatchConfig, value) |
| equipment-manager | Plugin not connected               | Throws "not connected" error                             |
```

**Do NOT skip this step.** Every feature must have a test plan before implementation begins.

### 2.4 Present Summary to User

After writing the spec, present a summary:

```
## Résumé de la spécification

**Feature**: [Name]
**Scope**: [In scope items]
**Data Model**: [New tables/fields]
**API**: [New endpoints]
**UI**: [New/changed views]
**Tests**: [Modules to test + number of scenarios]

Voulez-vous que j'implémente cette feature ?
```

> **GATE 2**: User has explicitly approved the spec ("oui", "yes", "go"). Do NOT proceed to implementation without explicit approval. If user has questions → update spec and re-present.

---

## Phase 3: Branch & Implement

### 3.1 Create Feature Branch (MANDATORY)

**ALWAYS create a branch. NEVER commit directly to main.**

```bash
git checkout main
git pull
git checkout -b feat/<feature-name>
```

Prefixes: `feat/`, `fix/`, `refactor/`, `docs/`

### 3.2 Implement in Order

Follow this strict order to avoid broken dependencies:

1. **Types first** — `src/shared/types.ts`, `src/shared/constants.ts`
2. **Database changes** — migration in `migrations/` (sequential numbering)
3. **Core / Event Bus** — new event types
4. **Domain logic** — managers, handlers (follow the reactive pipeline)
5. **Tests** — write unit/integration tests following existing patterns (see 3.4)
6. **API routes** — `src/api/routes/`, register in `src/api/server.ts`
7. **WebSocket** — broadcast new events
8. **UI** — stores, components, pages

### 3.4 Tests (MANDATORY — never skip)

Implement the test plan written in Phase 2.3. Every scenario from the plan must have a corresponding test.

- **Follow the plan**: implement each scenario listed in `specs/XXX/plan.md` test plan
- **Look at existing tests first**: find `*.test.ts` files in the same domain directory and follow the same patterns (mocking strategy, test structure, assertions)
- **What to test**: managers, evaluators, aggregators, parsers — anything with business logic
- **What NOT to test**: simple CRUD wrappers, direct DB queries, UI components (no React tests in this project)
- **Test file location**: same directory as the source file, named `<module>.test.ts`
- **Framework**: Vitest (already configured)
- **Verify coverage**: after writing tests, check that every scenario from the plan is covered. If a scenario is missing, add it before proceeding.

```bash
# Run a specific test file during development
npx vitest run src/<domain>/<module>.test.ts
```

### 3.3 Rules

All implementation rules are defined in `CLAUDE.md`. Key non-negotiables:

- TypeScript strict, no `any`
- UUID v4 for all IDs
- Pino logger only (never `console.*`)
- All handlers wrapped in try/catch
- Tailwind only, Lucide icons

> **GATE 3**: Code is written on a feature branch (NOT main). Verify with `git branch --show-current`.

---

## Phase 4: Test & Validate (MANDATORY)

**Do NOT commit without passing ALL checks.**

### 4.1 TypeScript Compilation

```bash
npx tsc --noEmit                    # Backend
cd ui && npx tsc --noEmit           # Frontend (if UI changes)
```

**ZERO errors required.**

### 4.2 Run Tests

```bash
cd /Users/mchacher/Documents/01_Geekerie/Sowel && npx vitest run
```

**ALL tests must pass.** If tests fail, fix them before proceeding.

### 4.3 Lint

```bash
npx eslint src/ --ext .ts
```

**ZERO errors required** (warnings are acceptable).

> **GATE 4**: TypeScript compiles with zero errors AND all tests pass AND lint has zero errors. Do NOT proceed if any check fails. Fix the issues first.

---

## Phase 5: Documentation & Commit

### 5.1 Update Documentation (if applicable)

If the feature adds or changes user-facing behavior, API endpoints, or architecture, update the documentation using `/update-docs`. Common triggers:

- New API endpoint → `docs/technical/api-reference.md`
- New equipment type → `docs/user/equipments.md` + `docs/technical/data-model.md`
- Architecture change → `docs/technical/architecture.md`
- New UI feature → relevant `docs/user/*.md` page
- Schema change → `docs/technical/data-model.md`

Also update the spec files:

- Mark acceptance criteria as `[x]` in `specs/XXX/spec.md`
- Mark tasks as `[x]` in `specs/XXX/plan.md`

### 5.2 Commit

Use conventional commits. Do NOT add Co-Authored-By lines.

```bash
git add <specific files>
git commit -m "feat(scope): description

Explanation of what and why."
```

Scopes: `mqtt`, `devices`, `equipments`, `zones`, `scenarios`, `recipes`, `ai`, `api`, `ws`, `ui`, `auth`, `db`, `core`, `plugins`, `backup`

### 5.3 Push & Create PR

```bash
git push -u origin feat/<feature-name>
gh pr create --title "feat: description" --body "..."
```

PR body must include: Summary, Changes, Test plan (with checkboxes for typecheck, tests, manual verification).

> **GATE 5**: PR is created and URL is shared with user. All acceptance criteria in `specs/XXX/spec.md` are checked `[x]`. All tasks in `specs/XXX/plan.md` are checked `[x]`. Documentation is updated if applicable.

---

## Phase 6: Wait for Merge Approval

**CRITICAL: Do NOT merge without explicit user confirmation.**

Present the PR URL and ask:

```
PR créée: [URL]. Voulez-vous que je merge dans main ?
```

- User says "oui" / "merge" → proceed to merge
- User has questions → address them first
- User says "non" / "attends" → STOP

### 6.1 Merge & Cleanup

Only after explicit user approval:

```bash
gh pr merge <number> --merge --delete-branch
git checkout main
git pull
```

> **GATE 6**: User has explicitly approved the merge. PR is merged, branch is deleted.

---

## Gate Summary

| Gate  | Condition                      | What happens if skipped |
| ----- | ------------------------------ | ----------------------- |
| **1** | Requirements clear             | Wrong feature built     |
| **2** | User approved spec             | Wasted implementation   |
| **3** | Code on feature branch         | Direct commits to main  |
| **4** | TypeScript + tests + lint pass | Broken code merged      |
| **5** | PR created                     | No code review possible |
| **6** | User approved merge            | Unauthorized merge      |
