---
name: sowel-recipe-dev
description: |
  Develop a personal Sowel recipe end-to-end: scaffold the external GitHub repo, implement the createRecipe factory, release the tarball, and install it on a Sowel instance through a personal source (spec 136). Use when the user wants to create their own recipe, build a custom automation as a recipe package, or iterate on a recipe against a live instance without touching the central registry.
argument-hint: "[recipe-name or automation idea]"
---

# Sowel Personal Recipe Development

Recipe to develop: $ARGUMENTS

Recipes are **external packages in their own GitHub repos** (spec 053/054) — never files inside the Sowel repo. The development loop uses **personal sources** (spec 136): add your repo as a source on your Sowel instance, install through the TOFU confirmation modal, publish a release for every iteration.

Follow the phases in order. Conventions come from `CLAUDE.md`; this skill only adds what is recipe-specific.

---

## Phase 1: Understand

### 1.1 Read first

| Source                                                                                               | What it gives you                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/shared/types.ts` (`RecipeDefinition`, `RecipeSlotDef`, `RecipeHelpers`, `RecipeInstanceHandle`) | The exact contract a recipe package must fulfil — this is the source of truth                          |
| `src/recipes/recipe-loader.ts`                                                                       | How packages are loaded: dynamic import of `dist/index.js`, `createRecipe` factory, `registerExternal` |
| `docs/technical/plugin-development.md`                                                               | Release conventions (tarball, versioning, registry) — shared with integration plugins                  |
| `specs/136-personal-plugin-sources/spec.md`                                                          | The personal-source trust model your dev loop relies on                                                |

Study one exemplar repo close to your use case (all under `github.com/mchacher/`):

- `sowel-recipe-schedule-on-off` — timers, sun-aware boundaries (`ctx.helpers.getSunlight()`), multi-equipment orders, i18n, tests
- `sowel-recipe-state-watch` — generic data-key watch with alarm events
- `sowel-recipe-motion-light` — classic sensor → actuator pattern

### 1.2 Clarify with the user

Do not assume. Ask until you can write the slot list without guessing:

- What triggers the automation (equipment data change, time, sun, mode)?
- What does it act on (orders to which equipment types)?
- What must be configurable (the future slots) vs hard-coded?
- Edge cases: instance stopped mid-action, equipment offline, overlapping triggers?

> **GATE 1** — you can state the recipe in one sentence ("When X, do Y on Z, unless W") and list its slots. Otherwise keep asking.

---

## Phase 2: Scaffold the repo

Naming: repo `sowel-recipe-<id>`, recipe id `<id>` (kebab-case). The id must not collide with any id in `plugins/registry.json` (spec 136 refuses shadowing at install).

```
sowel-recipe-<id>/
  manifest.json        # type: "recipe" — see below
  package.json         # "type": "module", scripts: build/dev/test
  tsconfig.json        # module + moduleResolution: "NodeNext", outDir dist
  src/
    index.ts           # exports createRecipe()
    index.test.ts      # vitest
  dist/                # compiled output — what Sowel actually loads
```

`manifest.json` (every field matters):

```json
{
  "id": "<id>",
  "type": "recipe",
  "name": "Human Name",
  "version": "0.1.0",
  "description": "One sentence, user-facing",
  "icon": "CalendarClock",
  "repo": "<owner>/sowel-recipe-<id>",
  "author": "<owner>",
  "tags": ["automation"],
  "i18n": { "fr": { "name": "...", "description": "..." } },
  "sowelVersion": ">=1.35.0"
}
```

Hard rules:

- `repo` **must equal the GitHub repo it is served from** — spec 136 refuses a mismatch at install.
- `type: "recipe"` routes the package to the RecipeLoader.
- `sowelVersion` ≥ the version introducing helpers you use (`getSunlight` needs ≥1.26 area; personal sources need ≥1.35.0 on the instance anyway).

`src/index.ts` skeleton — recipe packages **never import Sowel core**; they mirror the few types they need and export a factory:

```typescript
// Types mirrored from src/shared/types.ts — keep in sync manually.
interface RecipeSlotDef {
  /* id, name, description, type, required, ... */
}
interface RecipeInstanceHandle {
  stop(): void;
  onAction?(action: string): void;
}
interface RecipeDefinition {
  id: string;
  name: string;
  description: string;
  slots: RecipeSlotDef[];
  i18n?: Record<string, unknown>;
  validate(params: Record<string, unknown>, ctx: any): void;
  createInstance(params: Record<string, unknown>, ctx: any): RecipeInstanceHandle;
}

export function createRecipe(): RecipeDefinition {
  return {
    id: "<id>",
    name: "Human Name",
    description: "...",
    slots: [
      /* ... */
    ],
    validate(params, ctx) {
      /* throw with a clear message if params are bad */
    },
    createInstance(params, ctx) {
      // subscribe, arm timers...
      return {
        stop() {
          /* clear EVERY timer, unsubscribe EVERYTHING — must be idempotent */
        },
      };
    },
  };
}
```

> **GATE 2** — repo builds (`npm run build`) and `dist/index.js` exports `createRecipe`.

---

## Phase 3: Implement

- **Slots**: pick types from `RecipeSlotDef` (`zone`, `equipment`, `number`, `duration`, `time`, `boolean`, `text`, `data-key`, `select`). `equipment` slots declare `equipmentTypes` so the picker filters correctly.
- **Context (`ctx`)**: `ctx.log(msg)` for the instance log (user-visible), `ctx.state.set/get` for persisted state, `ctx.eventBus.on(...)` returning an unsubscribe, equipment accessors and order dispatch, `ctx.helpers` (`parseDuration`, `turnOnLights`, `getSunlight`, ...). Ground every call in `RecipeHelpers` / an exemplar repo — do not invent API.
- **Edge-guard your triggers** (hard-won gotcha): `equipment.data.changed` re-fires with unchanged values, and gate-derived state can arrive with `previous === undefined`. Track the last-seen value in the instance and only react on a real transition.
- **Never throw** from event handlers; wrap and `ctx.log` errors. `validate()` is the only place expected to throw.
- **stop() discipline**: clear every timer and unsubscribe every listener; instances are stopped/restarted on recipe update (issue #349) and on param edits.
- **i18n**: FR + EN for name, description, and every slot label (English is the fallback, the user's instances are FR).
- **Tests**: vitest in the recipe repo, following the exemplar (`index.test.ts` with a fake ctx). Timers → `vi.useFakeTimers()`.

> **GATE 3** — `npm run build` + `npm test` green; every scenario you promised in Phase 1 has a test.

---

## Phase 4: Release on GitHub

Versions must match in three places: `manifest.json`, git tag, tarball name.

```bash
npm run build
tar -czf sowel-recipe-<id>-<version>.tar.gz manifest.json package.json dist/
gh release create v<version> sowel-recipe-<id>-<version>.tar.gz --title "v<version>" --notes "..."
```

- Asset name **must** match `sowel-*.tar.gz` — that is what the installer looks for.
- **Bump the version for every iteration, even tiny ones.** Republishing a different tarball under the same tag changes the hash: pinned installs refuse it (`ChecksumMismatchError`) and re-downloads break. New version = new tag = clean TOFU re-confirmation.
- The repo must be **public** (personal sources do not support tokens).

> **GATE 4** — the release exists and its assets list shows the tarball.

---

## Phase 5: Install and iterate via a personal source (spec 136)

On the target Sowel instance (admin):

1. **Plugins → Store → Personal sources** → add `<owner>/sowel-recipe-<id>`.
2. The recipe appears in the store with the blue **Personal** badge → Install → the TOFU modal shows the release version and SHA256 fingerprint → confirm. The hash is pinned.
3. Create an instance from the recipe, exercise it for real, read the instance log.
4. Iterate: fix → bump version → new release → **Update** button on the Plugins page → the modal re-asks with the new fingerprint → confirm.

API equivalent (useful for scripted loops): `POST /api/v1/plugins/sources {repo}`, then `POST /api/v1/plugins/install {repo}` → 409 carries `{version, sha256}` → retry with `{confirmed: true, expectedSha256}`.

> **GATE 5** — the recipe runs on a live instance and the update loop has been exercised at least once.

---

## Phase 6 (optional): promote to community

When the recipe is worth sharing: open a PR against `plugins/registry.json` in the Sowel repo (entry with `version`, `owner`, `sha256` — run `node scripts/backfill-registry-sha256.mjs`). See `docs/technical/plugin-development.md`. The personal source can be removed once the registry entry is live; installed instances keep working either way.
