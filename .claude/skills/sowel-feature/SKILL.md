---
name: sowel-feature
description: |
  Creates features for Sowel — a home automation engine. Use when:
  - User asks to "create a feature", "implement X" for Sowel
  - User says "créer une feature", "ajouter une fonctionnalité", "implémenter"
  Specific to Sowel project: MQTT, devices, equipments, zones, recipes, modes, plugins.
argument-hint: "[description de la feature]"
---

# Sowel Feature Workflow

Feature request: $ARGUMENTS

Follow EVERY phase below IN ORDER. Each phase has a GATE — a condition that MUST be met before proceeding. Do NOT skip gates. Do NOT combine phases.

All conventions (commands, scopes, logging, implementation rules, design system) are in `CLAUDE.md` — read it, do not duplicate here. Key files and spec templates: [reference.md](reference.md).

**One feature per conversation.** A new idea that comes up on the way becomes a GitHub issue (`gh issue create`, with the user's go), never an addition to the feature in progress.

---

## Phase 1: Understand & Clarify

### 1.1 Read Essential Documentation

Before starting, read these IN ORDER:

| Document                                         | Purpose                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| `CLAUDE.md`                                      | AI agent entry point — conventions, rules, refs           |
| `docs/specs-index.md`                            | Grep it for related specs — there may already be a design |
| `docs/technical/architecture.md`                 | The sections of the domains the feature touches           |
| `src/shared/types.ts`, `src/shared/constants.ts` | The types and constants of those domains only (grep them) |

**Do NOT read `docs/sowel-spec.md`** — it's legacy and outdated.

Check the issue tracker for a related or duplicate request:

```bash
gh issue list --state all --search "<keywords>"
```

If the feature involves a specific domain, also read the relevant source files (see [reference.md](reference.md)). When in doubt about history, check the spec files in `specs/XXX-*/` for the relevant feature.

### 1.2 Deep-Dive Requirements

**Do not assume.** Go through the topics below and ask about whatever is unclear, **at most three questions per message**, each with your recommended answer when you have one.

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

**Continue until you can write a complete spec without assumptions.**
Ask user if they have any other inputs. If yes, ask more questions.

### 1.3 Check Existing Patterns

Search the codebase for similar patterns before designing the solution.

> **GATE 1 — Checklist** (verify ALL before proceeding):
>
> - [ ] 1.1 Done — I read CLAUDE.md, grepped specs-index.md, read the relevant architecture sections and types; I searched the issues
> - [ ] 1.2 Done — I asked clarifying questions and got answers (or requirements were already explicit)
> - [ ] 1.3 Done — I searched for similar patterns in the codebase
>
> Do NOT proceed until ALL boxes can be checked.

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

| File              | Content                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `spec.md`         | Requirements, acceptance criteria, scope, edge cases, **docs delta** |
| `architecture.md` | Data model, event flow, API contracts, file changes                  |
| `plan.md`         | Implementation steps, task breakdown, **test plan**                  |

Use the templates in [reference.md](reference.md). `scripts/check-specs-complete.sh` fails a PR whose new spec folder lacks one of the three.

### 2.3 Docs Delta (in `spec.md`)

List, page by page, what the feature changes in `docs/technical/` and `docs/user/`, **EN and FR pages together**, and the screenshots to retake. Start from the pages `scripts/docs-impact-map.sh` maps to the files you will touch.

If nothing a reader can observe changes, write the sentence that will become the PR's `Docs-Impact: none — <reason>` line.

### 2.4 Write Test Plan (in `plan.md`)

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

### 2.5 Specs Index

Add the spec's row to **both** `docs/specs-index.md` and `docs/specs-index.fr.md`, in its theme section, ending with `Unreleased.` (the release replaces it with `Shipped in vX.Y.Z.`). `scripts/check-specs-index.sh folders` fails the PR otherwise.

The summary is **one sentence of at most 250 characters**, the trailing `Unreleased.` / `Shipped in vX.Y.Z.` not counted: what the spec delivers, plus the words someone would grep for (issue number, amended spec, type or module name). The story and the detail belong in the spec folder; agents grep the index, they do not read it whole. The same script refuses a longer summary.

### 2.6 Present Summary to User

After writing the spec, present a summary:

```
## Résumé de la spécification

**Feature**: [Name]
**Scope**: [In scope items]
**Data Model**: [New tables/fields]
**API**: [New endpoints]
**UI**: [New/changed views]
**Docs**: [Pages EN/FR to update, or "none — reason"]
**Tests**: [Modules to test + number of scenarios]

Voulez-vous que j'implémente cette feature ?
```

> **GATE 2 — Checklist** (verify ALL before proceeding):
>
> - [ ] 2.1 Done — Spec folder exists in `specs/XXX-name/`
> - [ ] 2.2 Done — `spec.md`, `architecture.md`, `plan.md` written
> - [ ] 2.3 Done — Docs delta written (pages EN/FR, or the "none" reason)
> - [ ] 2.4 Done — Test plan written in `plan.md` (modules, scenarios table)
> - [ ] 2.5 Done — Row added to `docs/specs-index.md` and `docs/specs-index.fr.md`
> - [ ] 2.6 Done — Summary presented to user in the exact format
> - [ ] User has explicitly approved ("oui", "yes", "go")
>
> Do NOT proceed to implementation without explicit approval. If user has questions → update spec and re-present.

---

## Phase 3: Branch & Implement

### 3.1 Create Feature Branch (MANDATORY)

**ALWAYS create a branch. NEVER commit directly to main.**

```bash
git checkout main
git pull
git checkout -b feat/<feature-name>
```

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
9. **Docs** — apply the docs delta of 2.3, EN and FR together (`/sowel-docs` for screenshots and navigation)

**Do only what the spec says.** No unrelated refactor, no extra option. If the spec turns out wrong or incomplete, stop, tell the user, update the spec and get their approval again.

### 3.3 Rules

All implementation rules are in `CLAUDE.md` (conventions section). Read them there; the review agent checks them in Phase 5.

### 3.4 Tests (MANDATORY — never skip)

Implement the test plan written in Phase 2.4. Every scenario from the plan must have a corresponding test.

- **Follow the plan**: implement each scenario listed in `specs/XXX/plan.md` test plan
- **Look at existing tests first**: find `*.test.ts` files in the same domain directory and follow the same patterns (mocking strategy, test structure, assertions)
- **What to test**: managers, evaluators, aggregators, parsers — anything with business logic
- **What NOT to test**: simple CRUD wrappers, direct DB queries, UI components (no React tests in this project)
- **Test file location**: same directory as the source file, named `<module>.test.ts`
- **Framework**: Vitest (already configured)
- **A test must fail when the code is wrong**: for the core scenario, break the code once on purpose, see the test fail, restore the code
- **Verify coverage**: after writing tests, check that every scenario from the plan is covered. If a scenario is missing, add it before proceeding.

```bash
# Run a specific test file during development
npx vitest run src/<domain>/<module>.test.ts
```

> **GATE 3 — Checklist** (verify ALL before proceeding):
>
> - [ ] 3.1 Done — Feature branch created (NOT main). Verify: `git branch --show-current`
> - [ ] 3.2 Done — Implementation follows the order (types → DB → core → logic → tests → API → WS → UI → docs), nothing outside the spec
> - [ ] 3.4 Done — Every scenario from the test plan has a corresponding test; the core test seen failing on broken code

---

## Phase 4: Validate (MANDATORY)

**Do NOT commit without passing ALL checks.**

```bash
npm run validate
```

`validate` is the CI set in one command (backend and UI typecheck, `typecheck:tests`, lint, `format:check`, tests). Never run a hand-picked subset instead.

Then the documentation and spec checks the CI runs on every pull request:

```bash
bash scripts/check-specs-complete.sh
bash scripts/check-specs-index.sh folders
bash scripts/check-docs-parity.sh
bash scripts/check-docs-impact.sh
```

Locally the last two do not see the PR body, so they run in the strict case: a failure that the PR's `Docs-Parity:` or `Docs-Impact:` line (Phase 6) answers is expected. Any other failure is fixed, never bypassed.

Show the user the commands and the last lines of their output, never just "it passes".

> **GATE 4 — Checklist** (verify ALL before proceeding):
>
> - [ ] `npm run validate` green
> - [ ] `check-specs-complete` and `check-specs-index folders` green
> - [ ] `check-docs-parity` and `check-docs-impact` green, or every failure answered by a PR line written in Phase 6
>
> Do NOT proceed if any check fails. Fix the issues first.

---

## Phase 5: Agent Code Review (before PR)

**Before committing/opening the PR, the branch diff MUST be reviewed by the `sowel-reviewer` agent** (`.claude/agents/sowel-reviewer.md`: read-only, holds the review checklist). This catches correctness bugs, convention violations, missing docs and scope creep while they are still cheap to fix.

### 5.1 Launch the review agent

Spawn it with the Agent tool (`subagent_type: sowel-reviewer`). Give it:

- the branch and the spec folder `specs/XXX-<name>/`;
- anything you want looked at closely (a tricky edge case, a risky area).

It reports findings ranked by severity, each with a `file:line` pointer and a concrete failure scenario.

### 5.2 Triage and fix

- Fix every **blocking** finding (correctness, convention breach, missing test, missing doc).
- For non-blocking suggestions, either apply them or note explicitly why not.
- If code changed, **re-run Phase 4** before proceeding.
- Summarize the review outcome to the user (what was found, what was fixed).

> **GATE 5 — Checklist** (verify ALL before proceeding):
>
> - [ ] 5.1 Done — `sowel-reviewer` ran on the branch diff
> - [ ] 5.2 Done — All blocking findings fixed (or explicitly deferred with the user's agreement)
> - [ ] 5.2 Done — Phase 4 checks re-run and green if code changed after review
> - [ ] Review outcome summarized to the user
>
> Do NOT open the PR with unresolved blocking findings.

---

## Phase 6: Close the Spec & Commit

### 6.1 Close the spec

- Mark acceptance criteria as `[x]` in `specs/XXX/spec.md`
- Mark tasks as `[x]` in `specs/XXX/plan.md`

### 6.2 Commit

Conventional commit, scopes from `CLAUDE.md`. Do NOT add Co-Authored-By lines.

```bash
git add <specific files>
git commit -m "feat(scope): description

Explanation of what and why."
```

### 6.3 Push & Create PR

```bash
git push -u origin feat/<feature-name>
gh pr create --title "feat(scope): description (spec XXX)" --body "..."
```

PR body must include:

- Summary, Changes, Test plan (validate output, checks, manual verification);
- Docs: the pages updated, EN and FR;
- the review outcome (Phase 5);
- when needed, the lines the CI reads, the reason being required:
  - `Docs-Impact: none — <why nothing a reader can observe changed>`
  - `Docs-Parity: <untouched file> — <why only one language changed>`

> **GATE 6 — Checklist** (verify ALL before proceeding):
>
> - [ ] 6.1 Done — Acceptance criteria `[x]` in `spec.md`, tasks `[x]` in `plan.md`
> - [ ] 6.2 Done — Changes committed on feature branch (conventional commit, no Co-Authored-By)
> - [ ] 6.3 Done — Branch pushed, PR created with the body above
> - [ ] PR URL shared with user

---

## Phase 7: Wait for Merge Approval

**CRITICAL: Do NOT merge without explicit user confirmation.**

Present the PR URL and ask:

```
PR créée: [URL]. Voulez-vous que je merge dans main ?
```

- User says "oui" / "merge" → proceed to merge
- User has questions → address them first
- User says "non" / "attends" → STOP

### 7.1 Merge & Cleanup

Only after explicit user approval, and once the PR checks are green:

```bash
gh pr checks <number> --watch
gh pr merge <number> --squash --delete-branch
git checkout main
git pull
```

New needs raised during the feature: list them to the user and open an issue for each one they want kept.

> **GATE 7 — Checklist** (verify ALL before proceeding):
>
> - [ ] User has explicitly approved the merge ("oui", "merge", "go")
> - [ ] PR merged, branch deleted
> - [ ] On main branch, pulled latest
> - [ ] New needs turned into issues, or none

---

## Gate Summary

| Gate  | Condition                             | What happens if skipped     |
| ----- | ------------------------------------- | --------------------------- |
| **1** | Requirements clear                    | Wrong feature built         |
| **2** | User approved spec, docs delta, tests | Wasted implementation       |
| **3** | Code on feature branch, in scope      | Direct commits to main      |
| **4** | Validate + docs and spec checks pass  | Broken code or docs merged  |
| **5** | `sowel-reviewer` ran, blockers fixed  | Avoidable bugs reach the PR |
| **6** | PR created with docs and CI lines     | No human review, red CI     |
| **7** | User approved merge                   | Unauthorized merge          |
