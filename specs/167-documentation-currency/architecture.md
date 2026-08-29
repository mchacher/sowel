# Spec 167 — Architecture

## Where the enforcement lives today

One gate, one file. `.github/workflows/release.yml:53-76` (`verify-release-notes`) greps
`{ #vX-Y-Z }` in `docs/release-notes.md` and `.fr.md` at the tagged commit and fails the
workflow before the build jobs it gates. `.github/workflows/ci.yml:67-74`
(`Specs completeness`) runs `scripts/check-specs-complete.sh` on pull requests, but it checks
the presence of three files in a new spec folder, not documentation currency.

Nothing else in the repository has an opinion about whether documentation still matches the
code.

## The change

Three scripts and one workflow job, following the shape `check-specs-complete.sh` already
established: bash, portable to 3.2 (macOS ships it), no `mapfile`, no associative arrays,
takes an optional base ref, runs identically in CI and locally.

```
scripts/
  check-docs-parity.sh      R1  blocking   pull_request
  check-docs-impact.sh      R2  blocking   pull_request
  docs-impact-map.sh        R3  advisory   pull_request  (sourced by check-docs-impact.sh)
  check-specs-index.sh      R4  blocking   tag
```

### R1 — `check-docs-parity.sh`

For every `docs/**/*.md` in the diff against the merge base, derive its counterpart
(`x.md` <-> `x.fr.md`) and, when that counterpart exists in the tree, require it in the diff
too. A missing counterpart is waived by a `Docs-Parity:` trailer naming it.

The counterpart is derived rather than looked up in a list, so a new page pair is covered the
day it is created.

### R2 — `check-docs-impact.sh`

Fires only when both conditions hold:

- the pull request title matches `^(feat|fix)(\(.+\))?!?:`
- the diff touches `src/` or `ui/src/`

Then requires either a path under `docs/` in the diff, or a `Docs-Impact:` trailer whose reason
is non-empty. The reason is checked for content, not just presence: a bare `Docs-Impact: none`
fails, because the requirement is that a sentence was written.

### R3 — `docs-impact-map.sh`

A table of `source-prefix -> doc-page` pairs, emitted as a GitHub annotation. Deliberately
partial and deliberately non-blocking. Initial map, drawn from where the audit found the drift:

| Source prefix                                  | Likely page                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `ui/src/components/equipments/`                | `docs/user/equipments.md`                                         |
| `ui/src/components/energy/`                    | `docs/user/energy.md`, `docs/deep-dives/energy-tour.md`           |
| `ui/src/pages/`                                | `docs/user/`                                                      |
| `src/shared/types.ts`                          | `docs/technical/data-model.md`, `docs/technical/api-reference.md` |
| `src/api/routes/`                              | `docs/technical/api-reference.md`                                 |
| `src/shared/plugin-api.ts`, `src/plugins/`     | `docs/technical/plugin-development.md`                            |
| `src/recipes/`                                 | `docs/technical/recipe-development.md`                            |
| `src/packages/`                                | `docs/technical/plugin-development.md` (registry + trust tiers)   |
| `migrations/`                                  | `docs/technical/data-model/`                                      |
| `src/energy/`                                  | `docs/deep-dives/surplus-arbiter.md`                              |
| `docker-compose.yml`, `Dockerfile`, `scripts/` | `docs/technical/deployment.md`                                    |

The map is data, not logic, so extending it is a one-line change and carries no risk of failing
a build.

### R4 — `check-specs-index.sh`

Two assertions against `docs/specs-index.md`:

1. every `specs/NNN-*/` folder has a row whose number matches
2. no spec number that appears in a `### vX.Y.Z` block of `docs/release-notes.md` is still
   marked `Unreleased` in the index

Runs in `verify-release-notes`, which already exists, already runs at tag time, and already
gates every build job. Adding it there rather than creating a job keeps the failure in the place
maintainers already look when a release stops.

**This one lands red.** The index is currently 34 rows short and marks specs 139-166 as
unreleased. Acceptance criterion 8 requires green on `main`, so the index is corrected in the
same pull request as the script. That correction is the point of the check, not a cost of it.

## Reading the pull request body

Trailers come from `github.event.pull_request.body`, passed to the scripts as an environment
variable. No token, no `gh` call, works from a fork. Locally the variable is simply empty, which
means a local run is the strict case: it will not silently pass because of a trailer the runner
would have seen.

Matching is case-insensitive, tolerant of whitespace, and accepts `-`, `--` or `—` as the
separator. A gate failing on punctuation would teach people to distrust it.

## Files touched

| File                                        | Change                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `scripts/check-docs-parity.sh`              | new                                                                      |
| `scripts/check-docs-impact.sh`              | new                                                                      |
| `scripts/docs-impact-map.sh`                | new                                                                      |
| `scripts/check-specs-index.sh`              | new                                                                      |
| `.github/workflows/ci.yml`                  | one job, `Documentation currency`, running the two pull-request scripts  |
| `.github/workflows/release.yml`             | one step added to `verify-release-notes`                                 |
| `.github/pull_request_template.md`          | the two trailers, commented, with a one-line explanation                 |
| `CLAUDE.md`                                 | a `Documentation currency (spec 167 — MANDATORY for AI agents)` section  |
| `docs/specs-index.md`                       | 34 missing rows, 28 stale statuses (required for the gate to land green) |
| `docs/technical/contributing.md` + `.fr.md` | the contract, for humans                                                 |

## Why not the alternatives

**A label instead of a trailer.** Labels are invisible in the merge commit and in `git log`, and
an agent cannot set one without an extra API call. A trailer is in the body, is reviewed with the
change, and survives in history where the release sweep can grep it.

**A blocking path map.** Covered in the spec: the false positives are what break the gate's
credibility.

**Everything at release time.** The knowledge is at the pull request. A release-time sweep of
sixteen commits reconstructs from memory what the author knew an hour after writing the code.
R4 keeps only what is genuinely release-scoped.

**A docs coverage metric.** Measures pages, not truth. A page can be long, current in structure
and wrong in every claim, which is exactly what the audit found.

## Out of scope

Checking that documentation is _correct_ (no gate can), translation quality, screenshot decay,
and any gate on `chore` / `refactor` / `test` / `docs` pull requests.
