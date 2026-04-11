---
name: sowel-release
description: |
  Creates a new Sowel release. Use when:
  - User asks to "release", "tag", "publish", "deploy a new version"
  - User says "créer une release", "publier", "tagger"
  Bumps version, runs checks, tags, and pushes to trigger CI/CD.
disable-model-invocation: true
argument-hint: "<version> (e.g., 1.1.0, 1.0.1)"
---

# Sowel Release Workflow

Release version: $ARGUMENTS

Follow EVERY step below IN ORDER. Each step has a CHECK — verify before proceeding.

---

## Step 1: Validate Arguments

Parse the version from `$ARGUMENTS`. It must be a valid semver (e.g., `1.1.0`, `1.0.1`).

If no version is provided, read `package.json` current version, suggest the next minor bump, and ask the user to confirm.

> **CHECK**: Version number is confirmed.

---

## Step 2: Pre-flight Checks

Run ALL checks before touching anything:

```bash
# Must be on main branch, clean working tree
git branch --show-current   # must be "main"
git status --porcelain      # must be empty

# All CI checks must pass
npx tsc --noEmit
npx eslint src/ --ext .ts
npx vitest run
cd ui && npx tsc -b --noEmit && npx eslint .
```

**ALL must pass with ZERO errors.** If any check fails, STOP and fix before proceeding.

> **CHECK**: On main, clean tree, all checks pass.

---

## Step 3: Bump Version

Run the release script:

```bash
scripts/release.sh <version>
```

The script will:

1. Update version in `package.json` and `ui/package.json`
2. Commit: `release: vX.Y.Z`
3. Tag: `vX.Y.Z`
4. Push commit + tag to origin

> **CHECK**: Tag pushed. Verify with `git tag -l | tail -3`.

---

## Step 4: Monitor CI/CD

After pushing the tag, GitHub Actions will:

1. Run CI checks (typecheck, lint, tests)
2. Build Docker image (amd64)
3. Push to `ghcr.io/mchacher/sowel:<version>` and `ghcr.io/mchacher/sowel:latest`
4. Create GitHub Release with changelog

Check the workflow status:

```bash
gh run list --limit 3
```

Wait for it to complete. If it fails, investigate with:

```bash
gh run view <run-id> --log-failed
```

> **CHECK**: GitHub Actions workflow completed successfully.

---

## Step 5: Verify Release

```bash
# Check GitHub release exists
gh release view v<version>

# Check Docker image is published
docker pull ghcr.io/mchacher/sowel:<version>
docker run --rm ghcr.io/mchacher/sowel:<version> node -e "console.log(require('./package.json').version)"
```

Report to user:

```
Release v<version> publiée :
- GitHub Release: https://github.com/mchacher/sowel/releases/tag/v<version>
- Docker: ghcr.io/mchacher/sowel:<version>
- Docker: ghcr.io/mchacher/sowel:latest
```

> **CHECK**: Release and Docker image are live.
