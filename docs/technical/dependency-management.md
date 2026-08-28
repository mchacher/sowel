# Dependency Management

How to triage and merge the Dependabot pull requests on Sowel without breaking
CI, the runtime, or your afternoon. This is a maintainer playbook, distilled
from a full pass across the Sowel and passepartout backlogs.

The single most useful habit: **read _why_ a Dependabot PR is red before touching
it.** Almost every red is one of a few known shapes (peer conflict, engine
mismatch, new lint rule), not a code bug. Diagnosing the shape tells you the fix.

---

## Principles

1. **A green CI does not prove a runtime is safe.** CI runs typecheck, lint and
   unit tests. It does not click through the app. Runtime-state libraries can
   pass every test and still change behavior (see [Verify in-app](#verify-these-in-app)).
2. **A red CI is usually not a code bug.** On the last full pass, every red was a
   peer-dependency conflict or a Node engine mismatch, never a defect in Sowel's
   code. Look at which step failed:
   - **Install (ERESOLVE)** -> peer conflict. The bump is coupled to another
     package that must move with it. See [Coupled clusters](#coupled-clusters).
   - **Worker exited unexpectedly / native crash** -> a native module engine
     mismatch (Node version). See [The engines trap](#the-engines-trap).
   - **Typecheck / lint** -> a stricter compiler or a new lint rule. Real work,
     but scoped and predictable.
3. **Bump coupled majors together, in one PR.** Dependabot opens one PR per
   package. For peer-coupled toolchains, each PR fails alone and only the set
   installs. Consolidate them (or group them in config) and close the redundant
   individual PRs.
4. **Never let a dependency bump change the production runtime silently.** A
   dependency can force a Node upgrade through its `engines` field. That is an
   infrastructure decision (Dockerfiles + CI), not a library bump. Do it
   deliberately, on its own PR, and remember that merging is not deploying.

---

## Dependabot configuration

`.github/dependabot.yml` groups ordinary minor/patch bumps into one PR per
ecosystem (`backend-minor-patch`, `ui-minor-patch`, `github-actions`).

Linters, formatters and the TypeScript compiler are **excluded** from those
groups on purpose: a bump to any of them can fail CI on unchanged code (a new
lint rule, a reformat, a stricter typecheck), which would poison the whole group
and block every unrelated library. They ship as individual PRs so their upgrade
can be reviewed on its own.

**Recommended addition: a `build-tooling` group.** The web build chain
(`vite`, `@vitejs/*`, `vite-plugin-*`, `vitest`) is peer-coupled: `vitest`'s
major tracks `vite`'s, and `@vitejs/plugin-react` pins a `vite` peer range.
Ungrouped, Dependabot fragments them into individual majors that cannot merge
alone (you will see both a grouped PR and duplicate singletons for the same
deps). Group them so they travel as one reviewable unit:

```yaml
groups:
  ui-build-tooling:
    patterns:
      - "vite"
      - "@vitejs/*"
      - "vite-plugin-*"
      - "vitest"
      - "@vitest/*"
    update-types:
      - "minor"
      - "patch"
      - "major"
```

---

## Triage workflow

Sort the open PRs into tiers before merging anything.

| Tier | What                                                      | Action                                                                           |
| ---- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1    | CI/release workflow bumps (github-actions), no app code   | Merge (watch the next release for release.yml changes).                          |
| 2    | CI-green library bumps, including runtime-state libs      | Merge one by one. For runtime-state libs, a quick in-app check first.            |
| 3    | CI-red: peer conflicts, engine mismatches, new lint rules | Deliberate work. Consolidate coupled clusters, or hold with a documented reason. |

For each PR before merge:

1. **Read the failing step** (Section [Principles](#principles), point 2).
2. **Check for overlap.** Bumps that touch the same `package.json` / lockfile
   supersede each other. Merging one rebases or obsoletes the rest. Keep the
   highest version, close the stale ones with a one-line reason.
3. **Merge, rebase the next, regenerate the lockfile.** See
   [Merge mechanics](#merge-mechanics).

---

## Coupled clusters

These sets fail individually and only resolve together. Bump each as one PR.

### Web build toolchain

`@vitejs/plugin-react` -> `vite` -> `vitest`. `@vitejs/plugin-react` v6 requires
`vite ^8`; `vitest` v4 pairs with `vite` 8. Installing any one alone against an
older sibling throws `ERESOLVE`. **`vite` 8 switches the bundler to Rolldown**,
so verify the production build and the app, not only the tests.

### Web lint toolchain

`eslint` -> `eslint-plugin-react-hooks` -> `typescript-eslint`. `eslint` 10
requires `eslint-plugin-react-hooks` >= 6. Check that `typescript-eslint`'s
current range already lists `eslint ^10` (recent 8.x does).

Watch a **policy** trap here: `eslint-plugin-react-hooks` 7's `recommended`
config newly enables the opinionated React Compiler lints (`set-state-in-effect`,
`use-memo`). Adopting those is a separate decision, not a version bump. To keep
the lint policy unchanged, pin the two classic hook rules explicitly instead of
spreading the new recommended set:

```js
rules: {
  "react-hooks/rules-of-hooks": "error",
  "react-hooks/exhaustive-deps": "warn",
  // ...
}
```

`eslint` 10 also adds a core `no-useless-assignment` rule that may flag genuine
dead stores. Those are real, behavior-preserving cleanups; fix them.

### TypeScript 7: hold

`typescript` 7 is the new native (Go) compiler. `typescript-eslint` caps its
peer at `typescript <6.1.0` and rejects it, so any lint-tooled package (the UI,
the backend if it runs typescript-eslint) fails `ERESOLVE` on install. **Hold
the TS 7 PRs** and revisit when typescript-eslint ships native-compiler support.
Do not burn time forcing it. If the backend has no eslint it may pass in
isolation, but do not split the repo onto two major compilers for no benefit.

---

## The engines trap

A native module can require a newer Node than the project runs, and fail in a
way that looks like a test flake.

Symptom on CI: unit files that do not touch the module pass, then the file that
opens it dies with `Error: Worker exited unexpectedly` (the native addon
segfaults the vitest worker fork). It passes on a dev machine only because dev
machines run a newer Node.

Root cause: the module declares `engines: { node: ">=X" }` and ships no prebuild
for the CI/runtime Node. `npm` installs anyway (engines is a warning by default),
then the addon fails to load.

The precedent, and how Sowel handled it: **better-sqlite3 13 requires Node >= 22**
while Sowel ran **Node 20** everywhere and depended on `better-sqlite3 ^11.x`.
The day a better-sqlite3 major landed, that wall was production's problem.

**Do not react to it as a dependency bump.** Plan the Node move on its own terms.
The recipe below is what the Node 20 to 22 migration actually followed:

- Node 20 reached end of life on 2026-04-30, so the move was overdue hygiene
  regardless of any single dependency.
- **Change one variable.** Bump the runtime alone and freeze every dependency,
  `better-sqlite3` included. Riding a native-module major in on the same PR
  means a failure has two possible causes instead of one.
- Bump `Dockerfile` (every `FROM node:` stage **and** the NodeSource
  `setup_XX.x` line in the runtime stage, which is easy to miss because it is
  not a `FROM`), all `node-version` in CI and release workflows, and `engines`
  in `package.json` (root and any subpackage).
- Verify with a real `docker build` of each image on the new Node, and load the
  native module inside the built image (`node -e "require('better-sqlite3')..."`),
  which is the exact path that crashes on the wrong Node.
- Then run a **shadow** instance against a copy of production data before
  going anywhere near production.
- Merging the PR does not deploy. Roll the new images out on your own window.

Note the LTS calendar when picking a target: at the time of the 22 move, Node 22
was already in maintenance with end of life on 2027-04-30, so it buys support
rather than settling the question permanently.

---

## Merge mechanics

Sowel's `main` is protected by a ruleset: required checks (Backend/Frontend/scan),
and Dependabot PRs need one approval (owner approval satisfies it). Two traps:

1. **`gh pr merge --delete-branch` deletes the branch even when the merge fails.**
   If a PR is out of date and the merge is rejected, the branch is still deleted,
   which **closes the PR unmerged**. Recovery: recreate the change on a fresh
   branch off `main` (rebase, regenerate the lockfile) and open a new PR.
2. **PRs sharing a `package.json` / lockfile must be merged in sequence.** After
   merging one, the next is out of date and its lockfile conflicts. Rebase it on
   `main`, regenerate the lockfile (`git checkout --ours package-lock.json`, then
   `npm install`), re-run the checks, then merge. Merge the shared-lockfile PRs
   one at a time; merge the last one last so it stays current.

Lockfile churn on a `vitest` major (hundreds of deleted lines) is usually
legitimate dedup, not corruption: `vitest` 3/4 share a single top-level
`esbuild`/`vite` instead of `vitest` 2's nested per-package copies.

---

## Verify these in-app

CI does not exercise runtime behavior. Before merging a bump to a library that
drives live state or math, do a quick manual check, even if CI is green:

- **State stores** (`zustand`): load the app, exercise a flow, watch the console
  for render loops.
- **i18n** (`i18next`, `react-i18next`): confirm both languages still render.
- **Astronomical / time math** (`suncalc`): a major can shift the API or the
  output. Verify sunrise/sunset and anything downstream (sunlight, freecooling).
- **Logging** (`pino`): confirm structured logs and redaction still work.
- **Uploads / archives** (`@fastify/multipart`, `archiver`): exercise one
  round-trip.

Sowel is a production system. When in doubt, verify against a
[shadow instance](deployment.md), never production.

---

## Checklist

- [ ] Read which CI step failed before assuming code work.
- [ ] Grouped coupled majors into one PR; closed the redundant singletons.
- [ ] Held TS 7 and anything else blocked upstream, with a comment on the PR.
- [ ] For a native-module or engine bump, treated the Node move as its own
      deliberate PR, verified via `docker build`.
- [ ] Merged shared-lockfile PRs in sequence, rebasing and regenerating the
      lockfile between each; merged the last one last.
- [ ] Did an in-app check for any runtime-state library, even on green CI.
- [ ] Never deployed to production off the back of a merge without sign-off.
