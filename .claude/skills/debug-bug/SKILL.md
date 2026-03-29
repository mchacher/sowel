---
name: debug-bug
description: |
  Identifies and fixes bugs in Sowel — a home automation engine. Use when:
  - User reports a bug, error, or unexpected behavior
  - User says "ça ne marche pas", "bug", "erreur", "problème", "crash", "debug"
  - User asks to investigate logs, diagnose an issue, or troubleshoot
  - User shares an error message, stack trace, or screenshot of broken behavior
  Leverages structured log analysis (ring buffer API, fetch-logs.py), event bus tracing, and reactive pipeline inspection.
disable-model-invocation: true
argument-hint: "[description du bug]"
---

# Sowel Bug Investigation Workflow

Bug report: $ARGUMENTS

Follow EVERY phase below IN ORDER. Each phase has a GATE — a condition that MUST be met before proceeding. Do NOT skip gates.

All conventions are in `CLAUDE.md`. For log modules, diagnostic commands, and common bug patterns, see [reference.md](reference.md).

---

## Phase 1: Understand the Bug

### 1.1 Gather Symptoms

**Do not jump to conclusions. Collect all available information first.**

Ask the user about:

| Topic              | Questions to ask                                                     |
| ------------------ | -------------------------------------------------------------------- |
| **What**           | What is the observed behavior? What is the expected behavior?        |
| **When**           | When did it start? After a specific change, deploy, or restart?      |
| **Frequency**      | Always? Intermittent? Under specific conditions?                     |
| **Scope**          | Which domain? (devices, equipments, zones, scenarios, UI, API, etc.) |
| **Reproduction**   | Steps to reproduce? Specific device/equipment/zone involved?         |
| **Error messages** | Any error in UI? In terminal? In logs?                               |
| **Recent changes** | Any recent code change, config change, or integration update?        |

**Continue asking until you can precisely describe the bug and its context.**

### 1.2 Read Context

| Document              | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `CLAUDE.md`           | Project conventions, architecture, log levels |
| `src/shared/types.ts` | All TypeScript types — understand data shapes |

Also read the source files for the affected domain.

### 1.3 Check Recent Git History

```bash
git log --oneline -20
git log --oneline -10 -- src/<affected-domain>/
```

> **GATE 1**: Bug symptoms are clearly understood. You can describe the observed vs expected behavior precisely. Do NOT proceed until this is true.

---

## Phase 2: Analyze Logs

### 2.1 Log Retrieval

Use `fetch-logs.py` (preferred) or the direct API. See [reference.md](reference.md) for commands.

```bash
# Get errors from all modules
python3 scripts/logs/fetch-logs.py "" error 50

# Get warns (degradation signals)
python3 scripts/logs/fetch-logs.py "" warn 100

# Get debug logs from the affected module
python3 scripts/logs/fetch-logs.py <module> debug 100
```

### 2.2 Log Analysis Checklist

| Step | Action                                       | What to look for                                        |
| ---- | -------------------------------------------- | ------------------------------------------------------- |
| 1    | Fetch **error** logs (all modules)           | Unhandled errors, failed operations, stack traces       |
| 2    | Fetch **warn** logs (all modules)            | Degradation signals: reconnections, retries, stale data |
| 3    | Fetch **debug** logs for the affected module | Step-by-step operation trace                            |
| 4    | Correlate timestamps                         | What happened just before the error?                    |
| 5    | Look for recurring patterns                  | Same error repeating? Escalating frequency?             |
| 6    | Check structured context                     | `deviceId`, `equipmentId`, `zoneId` in entries          |

### 2.3 Temporarily Increase Log Level (if needed)

```bash
TOKEN=$(curl -s http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"<pwd>"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl -s -X PUT "http://localhost:3000/api/v1/logs/level" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"level":"debug"}'
```

> **GATE 2**: Logs have been analyzed. You have identified the pipeline layer where the bug occurs. Do NOT proceed without log evidence.

---

## Phase 3: Trace the Reactive Pipeline

### 3.1 Identify the Broken Layer

```
Integration message
  → Integration Plugin           ← Layer 1: Data ingress
    → Device Manager              ← Layer 2: Device state
      → Event Bus                 ← Layer 3: Event propagation
        → Equipment Manager       ← Layer 4: Equipment logic
          → Zone Manager          ← Layer 5: Zone aggregation
            → Scenario Engine     ← Layer 6: Automation
          → WebSocket → UI        ← Layer 7: UI display
```

### 3.2 Code Tracing

```bash
# Find where the relevant event is emitted/handled
grep -r "emit.*<event-name>" src/
grep -r "on.*<event-name>" src/
```

### 3.3 Database Inspection (if data-related)

```bash
sqlite3 data/sowel.db "SELECT * FROM <table> WHERE id = '<id>';"
```

> **GATE 3**: Root cause identified. You can explain: symptom, root cause, location (file:line), impact, and proposed fix.

---

## Phase 4: Present Diagnosis (MANDATORY)

**CRITICAL: Present findings BEFORE implementing a fix.**

```
## Diagnostic

**Symptôme**: [What is observed]
**Cause racine**: [Root cause explanation]
**Localisation**: [File:line — specific code involved]
**Impact**: [What is affected]
**Correctif proposé**: [Minimal fix description]

Voulez-vous que j'applique ce correctif ?
```

> **GATE 4**: User has explicitly approved the fix approach. Do NOT implement without approval.

---

## Phase 5: Fix & Validate

### 5.1 Create Fix Branch (MANDATORY)

**ALWAYS create a branch. NEVER commit directly to main.**

```bash
git checkout main && git pull
git checkout -b fix/<short-description>
```

### 5.2 Apply Minimal Fix

| Rule                       | Detail                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| **Minimal change**         | Fix ONLY the bug. No refactoring, no "while I'm here" changes                                  |
| **Same patterns**          | Follow existing code style in the file                                                         |
| **Add logging if missing** | If the bug was hard to find, add appropriate debug/warn logs                                   |
| **Add regression test**    | If the domain has existing tests, add a test case that reproduces the bug and verifies the fix |
| **No new features**        | A bug fix is not a feature. Stay focused                                                       |

### 5.3 Run ALL Checks

```bash
npx tsc --noEmit                                              # Backend
cd ui && npx tsc --noEmit                                     # Frontend (if UI changes)
cd /Users/mchacher/Documents/01_Geekerie/Sowel && npx vitest run  # Tests
npx eslint src/ --ext .ts                                     # Lint
```

**ALL must pass with ZERO errors.**

> **GATE 5**: TypeScript compiles, all tests pass, lint has zero errors, and the bug is confirmed fixed. Do NOT proceed if any check fails.

---

## Phase 6: Commit, PR & Merge

### 6.1 Commit (no Co-Authored-By)

```bash
git add <specific-files>
git commit -m "fix(<scope>): <description>

<Root cause explanation>"
```

### 6.2 Push & Create PR

```bash
git push -u origin fix/<short-description>
gh pr create --title "fix(<scope>): <short description>" --body "..."
```

### 6.3 Wait for Merge Approval

**CRITICAL: Do NOT merge without explicit user confirmation.**

```
PR créée: [URL]. Voulez-vous que je merge dans main ?
```

> **GATE 6**: User has explicitly approved the merge.

### 6.4 Merge

```bash
gh pr merge <number> --merge --delete-branch
git checkout main && git pull
```
