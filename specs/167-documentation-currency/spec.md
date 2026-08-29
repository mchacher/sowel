# Spec 167 — Documentation currency gates

## Context

The 2026-08-29 documentation audit (`docs/audit/2026-08-29-documentation.md`) found roughly
three months of drift: a plugin guide teaching an `executeOrder` signature that migration 004
removed, a French data model documenting an entity that never existed, an activity feed
described as volatile a year after it was made persistent, and a user guide with no mention of
six shipped equipment features.

The same audit contains the answer. **The only documentation artefact with a CI gate is the
only one that did not drift.** `docs/release-notes.md` and `.fr.md` carry 158 version anchors,
identical in both files, `v1-0-0` through `v1-62-0`, with no divergence at all. Spec 108 makes
the release workflow fail on a missing anchor before a single Docker layer is built. Meanwhile
`docs/specs-index.md` lost 34 rows and still marks 28 shipped specs as "Unreleased", and the
EN/FR pairs diverged on five API surfaces.

Same repository, same authors, same pace. The difference is enforcement.

This spec generalises the spec 108 mechanism from one file to the documentation as a whole,
and places most of it at pull-request time rather than at release time. The reason is where the
knowledge is: at the tag there are sixteen commits and no memory of which needed documentation;
in the pull request the author has just written the code and knows exactly.

The repository is worked almost entirely through AI agents. That changes the usual objection to
process gates, which is human fatigue leading to a token edit and an escape hatch taken by
default. It also changes what the gate must be: an agent reads `CLAUDE.md` at session start and
complies proactively, so the rule belongs there and the CI job is the backstop, exactly as
specs 089 and 108 are written.

## Requirements

### R1 — EN/FR parity is enforced per pull request

A pull request that modifies `docs/<path>.md` where `docs/<path>.fr.md` exists (or the reverse)
must modify both, or carry a `Docs-Parity:` trailer naming the file and a reason.

This is the cheapest check with the highest return: it alone would have prevented the MFA, roles,
equipment-status, camera-proxy and web-push sections being English-only in the API reference,
and the entire capacity-claim chapter being absent from the French recipe guide.

### R2 — A behaviour change states its documentation impact

A pull request whose title is a `feat(...)` or `fix(...)` conventional commit and which modifies
`src/` or `ui/src/` must either modify something under `docs/`, or carry a
`Docs-Impact: none — <reason>` trailer.

The reason is the load-bearing part. A checkbox is ticked without thought; a sentence that has
to be written is not. The trailer is deliberately not a label, so it lives in the pull request
body where it is reviewed alongside the change and survives in the merge commit.

### R3 — The pull request is told which pages are likely affected

A path map from source areas to documentation pages produces an advisory annotation naming the
pages that probably need a look. It never fails the build.

The split is deliberate: **heuristics inform, mechanics enforce.** A blocking check built on an
inexhaustive mapping is precisely where an escape hatch becomes the default path, because the
false positives train the author to reach for it. The map's job is to turn "did you think about
documentation" into "this page probably needs a look", which is far harder to dismiss and far
more actionable.

### R4 — Release-scoped artefacts are verified at the tag

Two checks join the existing `verify-release-notes` job, because they concern artefacts that are
release-scoped by nature and cannot be evaluated per pull request:

- every `specs/NNN-*/` folder has a row in `docs/specs-index.md`
- no spec whose number appears in a published release-notes entry is still marked "Unreleased"
  in the index

These would have caught the 34 missing rows and the 28 stale statuses.

### R5 — The rule is written where agents read it

A `CLAUDE.md` section states the contract before the gate is hit, in the register specs 089 and
108 already use. The CI job is enforcement; `CLAUDE.md` is the instruction. An agent that only
learns the rule from a red check has already written the pull request the wrong way.

### R6 — Every check runs locally

Each script runs standalone against `origin/main`, as `scripts/check-specs-complete.sh` does,
so an agent can verify before pushing rather than discovering the failure in CI.

## Explicitly NOT in scope

- **Requiring a documentation change on every pull request.** A `chore`, a `refactor`, a test or
  a dependency bump changes nothing a reader can observe. Gating them produces edits made to
  satisfy a gate, which is worse than no edit because it looks like maintenance.
- **Blocking on the path map.** See R3.
- **Checking that the documentation is correct.** No gate can do this. R2 catches omission by
  forgetting; it cannot catch omission by not knowing, which is what produced the worst finding
  in the audit: a new equipment type does not tell you that `user/equipments.md:47` claims the
  catalogue is closed. That class is caught by periodic review, not by CI.
- **Screenshots.** Staleness there is a function of time and UI churn, not of any single pull
  request. Noted in the audit as its own session.
- **Translation quality.** R1 checks that the French file was touched, not that the French is
  good.

## Acceptance criteria

1. A pull request touching `docs/technical/api-reference.md` alone fails, and names the missing
   `.fr.md`.
2. The same pull request passes with `Docs-Parity: docs/technical/api-reference.fr.md — <reason>`.
3. A `feat(ui): ...` pull request touching only `ui/src/` fails; it passes with a documentation
   change, or with `Docs-Impact: none — <reason>`.
4. A `chore(deps): ...` pull request touching `package.json` is not gated.
5. A `refactor(ui): ...` pull request touching `ui/src/` is not gated.
6. A pull request touching `ui/src/components/equipments/` is annotated with
   `docs/user/equipments.md` and does not fail on that account.
7. Tagging a version whose `specs/` contains a folder absent from `docs/specs-index.md` fails
   `verify-release-notes`, before any image is built.
8. Every script exits 0 on `main` as it stands today, so the gates land green rather than
   requiring a cleanup first.
9. Each script runs locally with no arguments.

## Edge cases

- **A file with no translation.** `docs/technical/dependency-management.md` has no `.fr.md`.
  R1 only fires when the counterpart exists, so it stays silent rather than demanding a new
  translation.
- **A new page added in one language.** Creating `docs/user/foo.md` with no `.fr.md` does not
  fire R1, since the counterpart does not exist. Deliberate: forcing a translation at creation
  time would push authors to write neither.
- **A revert.** Carries the original title, so a `feat` revert is gated. Acceptable: a revert of
  a user-visible feature does have documentation impact.
- **The release pull request.** Title is `release: vX.Y.Z`, not `feat`/`fix`, so R2 does not
  fire. It touches both release-notes files, so R1 is satisfied.
- **A pull request touching only `docs/`.** R2 does not apply (no `src/` change); R1 does.
- **A merge from a fork.** The pull request body is available on the `pull_request` event, so
  trailers are readable without a token.
- **Case and spacing in trailers.** Matched case-insensitively with flexible whitespace, and
  both `—` and `-` accepted as the separator, so a gate is never failed on punctuation.
