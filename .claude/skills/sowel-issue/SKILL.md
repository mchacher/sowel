---
name: sowel-issue
description: |
  Handles a GitHub issue end-to-end for Sowel: qualify it, improve its write-up, implement the fix or feature, open the PR, and close the issue once the PR is merged. Use when:
  - User points at a GitHub issue ("traite l'issue 42", "regarde les issues ouvertes")
  - User asks to triage, qualify, or clean up the issue tracker
argument-hint: "[issue number or search terms]"
---

# Sowel GitHub Issue Workflow

Issue to handle: $ARGUMENTS

Follow EVERY phase below IN ORDER. Each phase has a GATE — verify before proceeding. Do NOT skip the qualification phases and jump to code.

All project conventions are in `CLAUDE.md` (read it first). All written output on GitHub (issue body, comments, commits, PR) is in English.

---

## Phase 1: Qualify the Issue

### 1.1 Load the issue

```bash
gh issue view <number> --comments        # full thread
gh issue list --state open --limit 30    # if no number was given: pick with the user
```

### 1.2 Understand and verify

- Classify: **bug / feature request / docs / question / invalid**.
- For a bug: try to reproduce or at least locate the failing path in the code. Read the relevant module and check `docs/specs-index.md` for the spec that shipped the behavior.
- For a feature: check whether a spec or a rejected/parked idea already covers it.
- Check duplicates: `gh issue list --state all --search "<keywords>"`.
- Identify what is missing from the report: version, logs, steps, expected vs actual, hardware/integration involved.

### 1.3 Present the qualification

Present a short summary to the user:

```
## Qualification issue #<n>

**Type**: bug | feature | docs | question | duplicate of #<m> | invalid
**Domain**: <devices | equipments | zones | recipes | plugins | energy | ui | ...>
**Severity / value**: <impact for a bug, user value for a feature>
**Root cause / design hint**: <what the code reading revealed, or "needs debugging">
**Missing info**: <what should be asked to the reporter, if anything>
**Proposed path**: quick fix | full feature workflow | debugging first | close (duplicate/invalid)
```

> **GATE 1**: User agrees with the qualification and the proposed path. If information is missing from the reporter, post a comment asking for it (`gh issue comment`) and STOP here until answered.

---

## Phase 2: Improve the Issue Write-up

A well-written issue is the spec of the fix. Rewrite title and body:

- **Title**: imperative and specific, e.g. `Zone humidity aggregation ignores offline equipments` (not "bug humidity").
- **Body structure**: Context / Steps to reproduce / Expected / Actual / Technical notes (code pointers found in Phase 1) / Acceptance criteria.
- If the issue was authored by someone else, preserve their original text at the bottom inside a `<details><summary>Original report</summary>...</details>` block — never silently erase a reporter's words.
- Apply labels (`bug`, `enhancement`, `documentation`, ...) with `gh issue edit --add-label`.

```bash
gh issue edit <n> --title "..." --body-file /tmp/issue-<n>.md
```

> **GATE 2**: Rewritten body shown to the user BEFORE `gh issue edit` is run, and user approved it.

---

## Phase 3: Route the Work

| Situation                                   | Route                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Small, well-understood fix (single concern) | Continue with this workflow                                               |
| Root cause unknown                          | Run the `sowel-debug` skill first, then come back here                    |
| Real feature (data model, API, UI surface)  | Run the `sowel-feature` skill (spec in `specs/XXX/`), then come back here |
| Duplicate / invalid / question answered     | Close with a polite explanatory comment; workflow ends here               |

> **GATE 3**: Route confirmed with the user.

---

## Phase 4: Implement

```bash
git checkout main && git pull
git checkout -b fix/issue-<n>-<slug>     # or feat/issue-<n>-<slug>
```

- Follow every convention in `CLAUDE.md` (types, logging, migrations order, UI rules).
- **Tests are mandatory** for every fix and feature — a bug fix gets a regression test that fails before the fix.
- Reference the issue in the commit message body, e.g. `fix(zones): skip offline equipments in humidity aggregation (#<n>)`.
- Run the full validation: `npx tsc --noEmit`, `npx eslint src/ --ext .ts`, `npx vitest run`, and the UI checks if the UI changed.

> **GATE 4**: All checks pass. Verify the branch with `git branch --show-current` right before committing.

---

## Phase 5: Agent Review

Before opening the PR, get an **independent agent** to review the change. A second pass catches correctness bugs, altitude problems (band-aid vs root fix), test gaps, and i18n/convention slips the implementer is blind to.

- Launch a `general-purpose` agent (or run the `code-review` skill) on the branch diff (`git diff main...HEAD`). Give it the issue and the change, and ask it to review for: **correctness** (edge cases, races, inverted conditions, null/await), **altitude** (right depth or a band-aid over a deeper cause), **test soundness** (does the test actually fail without the fix), and **convention/i18n slips** (CLAUDE.md rules, mixed-language strings).
- Prefer **empirical** verification when the change has a runtime surface the agent can exercise (drive the component, spin the container, run the flow) over reading alone.
- Triage the findings: apply the confirmed ones on the branch as a follow-up commit; explicitly note anything deliberately deferred and why.
- Re-run the Phase 4 validation after applying fixes.

> **GATE 5**: Agent review run; confirmed findings fixed (or deferred with a reason); the review outcome surfaced to the user.

---

## Phase 6: Pull Request

```bash
gh pr create --title "<conventional title> (#<n>)" --body "...

Closes #<n>"
```

- The body must explain the root cause (for a bug) or the design (for a feature), list the tests added, and contain the `Closes #<n>` line so the merge auto-closes the issue.
- Present the PR to the user and **wait for explicit approval before merging**. Never merge on your own.

> **GATE 6**: PR presented; user has explicitly approved the merge ("oui", "merge", "go").

---

## Phase 7: Close the Loop

After the merge:

1. Verify the issue auto-closed (`gh issue view <n>`); if not, close it: `gh issue close <n> --comment "..."`.
2. Post a final comment on the issue summarizing the fix in one or two sentences and naming the PR, so the reporter knows what shipped. If a release is planned, mention that the fix lands in the next release.
3. If the fix changed user-facing behavior, update the docs (`sowel-docs` skill) and make sure the change will be covered by the next release notes entry (spec 108).

> **GATE 7**: Issue closed, reporter informed, docs/release-notes follow-up identified.
