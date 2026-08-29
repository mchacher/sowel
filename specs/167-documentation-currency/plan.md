# Spec 167 — Plan

## Tasks

### 1. Scripts

- `scripts/check-docs-parity.sh` — R1. Diff against merge base, derive `.md` <-> `.fr.md`
  counterparts, require both when the counterpart exists, waive on `Docs-Parity:`.
- `scripts/docs-impact-map.sh` — R3. The source-prefix to doc-page table, emitted as GitHub
  annotations. Sourced by the impact check; never exits non-zero.
- `scripts/check-docs-impact.sh` — R2. Gate on `feat`/`fix` title plus a `src/` or `ui/src/`
  change; require a `docs/` change or a `Docs-Impact:` trailer with a non-empty reason. Emits
  the map's annotations on the way through.
- `scripts/check-specs-index.sh` — R4. Every `specs/NNN-*/` has a row; no spec cited in a
  published release-notes block is still `Unreleased`.

All four: bash 3.2, `set -euo pipefail`, optional base-ref argument defaulting to `origin/main`,
usable with no arguments locally, header comment in the style of `check-specs-complete.sh`.

### 2. Wiring

- `.github/workflows/ci.yml` — a `Documentation currency` job running the parity and impact
  checks, with `PR_BODY: ${{ github.event.pull_request.body }}` and
  `fetch-depth: 0` for the merge-base diff.
- `.github/workflows/release.yml` — one step in `verify-release-notes` calling
  `check-specs-index.sh`.
- `.github/pull_request_template.md` — both trailers as commented lines with a one-line
  explanation of when to use them.

### 3. Shipping order — R4 travels separately

The parity and impact checks are diff-scoped, so they cannot fail on existing content and land
green immediately. `check-specs-index.sh` cannot: the index is 34 rows short and marks specs
139-166 as unreleased, so the script fails on `main` the day it is written.

Correcting the index is data entry across 34 rows plus 28 statuses cross-checked against
`docs/release-notes.md`, and the 2026-08-29 audit already schedules exactly that work in its
PR 6. Bundling it here would make one pull request out of two unrelated reviews.

So:

- **PR A (this one)** — R1, R2, R3, R5, R6. The pull-request gates, live straight away, in time
  for the seven audit remediation PRs to run under them.
- **PR B (with audit PR 6)** — `check-specs-index.sh`, wired into `verify-release-notes`, landing
  in the same pull request as the index correction that makes it pass.

Confirm before wiring that the two PR-time scripts pass against `main` as it stands.

### 4. Write the rule where agents read it

- `CLAUDE.md` — a `Documentation currency (spec 167 — MANDATORY for AI agents)` section, in the
  register of the existing spec 089 and spec 108 sections: what the two trailers are, when each
  applies, and that the checks run locally.
- `docs/technical/contributing.md` + `.fr.md` — the same contract for humans. Note this page is
  itself on the audit's correction list (PR 5), so keep the addition self-contained to avoid a
  conflict.

## Test Plan

No unit-test framework covers shell scripts here, and mocking a pull request event would test
the mock. The scripts are verified against real git history, which is what they read.

### Verification matrix

Each row is a real commit or a scratch branch, checked with the script run directly.

| Case                                                                               | Expectation                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `main` as it stands, all four scripts                                              | parity/impact/specs-complete pass; specs-index fails until task 3 |
| Commit `8a4ffbd8` (`feat(equipments)`, touches `src/` + `ui/src/` + `docs/`)       | impact passes on the `docs/` change                               |
| Commit `0fc42635` (docs only, EN+FR pairs)                                         | parity passes                                                     |
| Scratch: edit `docs/technical/api-reference.md` only                               | parity fails, names `api-reference.fr.md`                         |
| ... plus `Docs-Parity: docs/technical/api-reference.fr.md — <reason>` in `PR_BODY` | passes                                                            |
| Scratch: `feat(ui):` title, edit `ui/src/` only                                    | impact fails                                                      |
| ... plus `Docs-Impact: none — <reason>`                                            | passes                                                            |
| ... plus a bare `Docs-Impact: none`                                                | still fails, the reason is required                               |
| Scratch: `chore(deps):` title, edit `package.json`                                 | not gated                                                         |
| Scratch: `refactor(ui):` title, edit `ui/src/`                                     | not gated                                                         |
| Scratch: edit `docs/technical/dependency-management.md` (no `.fr.md`)              | parity silent                                                     |
| Scratch: create `docs/user/foo.md` alone                                           | parity silent, counterpart does not exist                         |
| Trailer written `docs-impact: none - reason`                                       | accepted, matching is case and punctuation tolerant               |
| Empty `PR_BODY` (local run)                                                        | strict: no trailer can waive anything                             |
| Scratch: `specs/168-x/` with no index row                                          | specs-index fails                                                 |
| Scratch: spec 166 marked `Unreleased` while cited in the v1.60.0 block             | specs-index fails                                                 |

### Live verification

The pull request carrying this spec is itself the first subject: it touches `docs/` and
`specs/`, no `src/`, so R2 must stay silent and R1 must be satisfied by the `specs-index.md`
edit needing no French counterpart. Then the seven documentation remediation pull requests from
the audit run under the new gates, which is the real test: if the parity check is going to be
annoying, seven consecutive documentation pull requests will show it immediately.

### Retro-compat

- No runtime code, no migration, no API, no UI. Nothing ships in the Docker image.
- The new CI job is additive; existing required checks are untouched.
- `verify-release-notes` gains a step. If `check-specs-index.sh` is wrong, a release is blocked,
  which is the same failure mode spec 108 already accepts, and the recovery is the same: fix,
  amend, re-tag.
