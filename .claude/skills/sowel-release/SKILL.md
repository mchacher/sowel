---
name: sowel-release
description: |
  Creates a new Sowel release. Use when:
  - User asks to "release", "tag", "publish", "deploy a new version"
  - User says "créer une release", "publier", "tagger"
  Release-notes check, version bump via PR, tag on main, CI/CD monitoring.
disable-model-invocation: true
argument-hint: "<version> (e.g., 1.1.0, 1.0.1)"
---

# Sowel Release Workflow

Release version: $ARGUMENTS

Follow EVERY step below IN ORDER. Each step has a CHECK — verify before proceeding.

Main is protected (ruleset: PR required, no direct push, linear history). A release is therefore a **PR merge followed by a tag on main**. Do not try to push the release commit directly to main.

Do NOT cut a release whose only content is a plugin registry bump — registry changes propagate on merge, no Sowel version needed.

---

## Step 1: Validate Arguments

Parse the version from `$ARGUMENTS`. It must be a valid semver (e.g., `1.1.0`, `1.0.1`).

If no version is provided, read `package.json` current version, suggest the next minor bump, and ask the user to confirm.

> **CHECK**: Version number is confirmed.

---

## Step 2: Pre-flight Checks

```bash
git checkout main && git pull
git status --porcelain      # must be empty

# All CI checks must pass
npx tsc --noEmit
npx eslint src/ --ext .ts
npx vitest run
cd ui && npx tsc -b --noEmit && npx eslint .
```

**ALL must pass with ZERO errors.** If any check fails, STOP and fix before proceeding.

> **CHECK**: On up-to-date main, clean tree, all checks pass.

---

## Step 3: Release Notes (MANDATORY — spec 108)

The `verify-release-notes` job in `.github/workflows/release.yml` fails the whole build if the tagged commit lacks the anchors below. Write the notes BEFORE tagging:

1. List everything shipped since the last release: `git log v<last>..main --oneline --no-merges`. The notes must cover **all** merged PRs in that range, not just the latest change.
2. Add a `### vX.Y.Z — YYYY-MM-DD { #vX-Y-Z }` block under the matching minor section in **both** `docs/release-notes.md` and `docs/release-notes.fr.md`. The explicit `{ #vX-Y-Z }` anchor is required (the in-app UpdatesSheet links to it).

> **CHECK**: Both release-notes files have the new block with the `{ #vX-Y-Z }` anchor.

---

## Step 4: Release PR

```bash
git checkout -b release/v<version>
# Bump "version" in package.json AND ui/package.json
# Stage the bumps together with the release-notes entries
git add package.json ui/package.json docs/release-notes.md docs/release-notes.fr.md
git commit -m "release: v<version>"
git push -u origin release/v<version>
gh pr create --title "release: v<version>" --body "Version bump + release notes for v<version>"
```

Present the PR and **wait for explicit user approval before merging**. Merge so that the release commit lands on main with the exact files above (linear history: rebase or squash merge).

> **CHECK**: Release PR merged. `git log origin/main -1` shows the `release: v<version>` commit.

---

## Step 5: Tag the On-Main Commit

Tag the merged commit **on main** (never the branch-side commit):

```bash
git checkout main && git pull
git log -1                       # must be "release: v<version>"
git tag v<version>
git push origin v<version>
```

> **CHECK**: Tag pushed. Verify with `git tag -l | tail -3`.

Note: `scripts/release.sh` predates the main protection ruleset (it commits and pushes to main directly, which is now rejected). Use the PR flow above.

---

## Step 6: Monitor CI/CD

After pushing the tag, GitHub Actions will:

1. Verify release notes anchors (fails fast if missing — recovery: add the entries, amend, `git tag -f v<version> && git push --force origin v<version>`)
2. Run CI checks (typecheck, lint, tests)
3. Build Docker images (amd64 + arm64) and push `ghcr.io/mchacher/sowel:<version>` and `:latest`
4. Create the GitHub Release with changelog

```bash
gh run list --limit 3
gh run view <run-id> --log-failed   # if it fails
```

Do NOT poll in a fire-and-forget background loop; check directly, then act.

> **CHECK**: GitHub Actions workflow completed successfully.

---

## Step 7: Verify Release

```bash
gh release view v<version>
docker pull ghcr.io/mchacher/sowel:<version>
docker run --rm ghcr.io/mchacher/sowel:<version> node -e "console.log(require('./package.json').version)"
```

Report to user:

```
Release v<version> publiée :
- GitHub Release: https://github.com/mchacher/sowel/releases/tag/v<version>
- Docker: ghcr.io/mchacher/sowel:<version> (amd64 + arm64)
- Release notes: https://docs.sowel.org/release-notes/#v<x>-<y>-<z>
```

> **CHECK**: Release, Docker images and release-notes link are live.

Releasing does NOT authorize deploying to the production host — that always requires an explicit, separate user go-ahead.
