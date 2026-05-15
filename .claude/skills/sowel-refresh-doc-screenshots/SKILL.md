---
name: sowel-refresh-doc-screenshots
description: Regenerate the Sowel user guide screenshots (FR + EN) from a fresh production snapshot. Use when the UI has changed enough that the docs look outdated, or when the user asks to refresh / update screenshots.
user-invocable: true
argument-hint: "[page-name | all]"
---

# Sowel Documentation Screenshots Refresh

Target: $ARGUMENTS (defaults to `getting-started` when no argument is given)

## What this skill does

Captures a consistent, bilingual set of user guide screenshots by piloting `domopi.local` with Playwright. The pipeline is fully reproducible because it builds from a **fresh production backup** anonymized via `scripts/doc/build-fixtures.py` and restored on a clean demo instance.

The skill is **destructive on domopi** (wipes its database multiple times). Domopi is the official demo instance for this purpose, treat it as disposable.

## Prerequisites

| Need                             | How to check                                              |
| -------------------------------- | --------------------------------------------------------- |
| Playwright MCP tools accessible  | `mcp__playwright__browser_navigate` available             |
| SSH access to domopi             | `ssh mchacher@domopi.local 'echo ok'` returns ok          |
| Prod admin credentials in memory | Reference memory file `reference_sowel_access.md`         |
| Working `python3` + `node`       | Needed for build-fixtures.py and bcrypt hash regeneration |

If the Playwright MCP browser session is stuck on a prior cache lock, ask the user before `kill -9` on the orphan Chrome process (the cache path is `~/Library/Caches/ms-playwright/mcp-chrome-*`).

## Decisions to confirm before starting

Ask the user via `AskUserQuestion` before launching the long Playwright sequence:

1. **Scope**: refresh getting-started only, or also other user guide pages (equipments, dashboard, zones, modes, energy, devices, remote-access)? Each page family needs its own capture loop.
2. **Source language for the prod copy**: prod is in French. The FR fixture is the prod backup anonymized. The EN fixture is the FR fixture with zone + equipment names translated. If new prod equipment names appear, extend the EN translation map in `scripts/doc/build-fixtures.py`.
3. **Anonymization mapping**: confirm any new personal data appearing in prod (children's bedroom names, named sensors, specific appliances like a washing machine) and add them to the rename / delete maps in the script.
4. **Viewport**: default is 1920x1080 light mode. Change only if the user asks for mobile or dark mode shots.

## Pipeline (4 phases)

### Phase 0: Build fixtures from a fresh prod backup

```bash
# Export prod backup (replace credentials with the reference memory)
TOKEN=$(curl -s -X POST http://192.168.0.230:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"<from-memory>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

mkdir -p /tmp/sowel-doc-work && cd /tmp/sowel-doc-work
curl -s -H "Authorization: Bearer $TOKEN" \
  http://192.168.0.230:3000/api/v1/backup -o prod-backup.zip

# Build the two fixtures
python3 /Users/mchacher/Documents/01_Geekerie/Sowel/scripts/doc/build-fixtures.py prod-backup.zip
cp showroom-fr.zip showroom-en.zip \
  /Users/mchacher/Documents/01_Geekerie/Sowel/docs/fixtures/
```

The script removes integration credentials, anonymizes personal data, neutralizes `home.name` and coordinates, bakes a default admin (`admin` / `sowel-demo-2026`), and produces both language variants.

If a new prod equipment introduces a personal name, edit `ZONE_RENAME_FR`, `EQUIPMENT_RENAME_FR`, `EQUIPMENT_DELETE_FR`, or the translation maps at the top of [scripts/doc/build-fixtures.py](scripts/doc/build-fixtures.py).

### Phase 1: Wizard EN (4 shots)

Capture the first-run experience in English on a freshly wiped instance.

```bash
ssh mchacher@domopi.local 'cd /home/mchacher/sowel-demo && docker compose down -v && docker compose up -d'
until curl -fsS --max-time 10 http://domopi.local:3001/api/v1/auth/setup-status > /dev/null; do sleep 3; done
```

Then in Playwright:

1. `browser_resize` 1920x1080
2. `browser_navigate http://domopi.local:3001/`
3. `browser_evaluate` to set `localStorage.sowel_language = 'en'`, then navigate to `/setup`
4. Screenshot → `getting-started-setup-en.png`
5. Fill the admin form (username `admin`, password `sowel-demo-2026`), click "Create account"
6. The welcome wizard appears at `/dashboard` overlaying it. Screenshot → `getting-started-home-empty-en.png`
7. Fill home name + lat/long + click Continue. **Important**: Playwright's `fill()` does not always propagate to React state. Use `browser_evaluate` with the native setter trick:
   ```js
   const setNativeValue = (el, v) => {
     const proto = Object.getPrototypeOf(el);
     const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
     setter.call(el, v);
     el.dispatchEvent(new Event("input", { bubbles: true }));
   };
   ```
8. **Before** clicking Continue, take the `getting-started-home-filled-en.png` screenshot
9. Clicking Continue saves the settings and auto-restarts the engine. Wait for `/api/v1/auth/setup-status` to return again.
10. Open the avatar menu (the Log out button has `aria-label="Log out"` in EN, no visible text). Click it. URL goes to `/login`.
11. Screenshot → `getting-started-login-en.png`

### Phase 2: Wizard FR (4 shots)

Same sequence as Phase 1, but:

- Reset domopi again (`docker compose down -v && up -d`)
- Set `localStorage.sowel_language = 'fr'`
- Button labels become "Créer le compte", "Continuer", "Se connecter", and the avatar Log out title becomes "Se déconnecter"

Produces: `setup-fr`, `home-empty-fr`, `home-filled-fr`, `login-fr`.

### Phase 3: Restored fixture FR (5 shots)

Now use the fixture to land directly in a populated, ready state.

```bash
TOKEN=$(curl -s --max-time 15 -X POST http://domopi.local:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"sowel-demo-2026"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl -s -X POST http://domopi.local:3001/api/v1/backup \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/Users/mchacher/Documents/01_Geekerie/Sowel/docs/fixtures/showroom-fr.zip" \
  --max-time 120

ssh mchacher@domopi.local 'docker restart sowel'
until curl -fsS --max-time 10 http://domopi.local:3001/api/v1/auth/setup-status > /dev/null; do sleep 3; done
```

The restore replaces every table including users, but the fixture already contains the `admin` / `sowel-demo-2026` user, so login still works after restart.

In Playwright (with `localStorage.sowel_language = 'fr'`):

1. Log in via `/login` using the native value setter trick
2. Capture each page after a 2-3 second wait for async data to settle:
   - `/integrations` → `getting-started-integrations-fr.png`
   - `/devices` → `getting-started-devices-fr.png`
   - `/zones` → `getting-started-zones-fr.png`
   - `/home/00000000-0000-0000-0000-000000000001` → `getting-started-home-fr.png`
   - `/dashboard` → `getting-started-dashboard-fr.png`

### Phase 4: Restored fixture EN (5 shots)

Upload `showroom-en.zip` the same way, restart, log in with `sowel_language = 'en'`. Capture the same 5 URLs with `-en` suffix.

## Phase 5: File placement and doc updates

After Playwright finishes, the screenshots are saved to the project root by default. Move them:

```bash
cd /Users/mchacher/Documents/01_Geekerie/Sowel
mv getting-started-*.png docs/screenshots/
```

If a previously language-neutral screenshot now varies by language (because UI labels are translated), rename the obsolete file:

```bash
git rm docs/screenshots/getting-started-<name>.png
```

Then update `docs/user/getting-started.md` and `docs/user/getting-started.fr.md` so each image reference points to its language-specific variant.

## Verification

```bash
mkdocs build --strict
```

The command must finish without errors. Image references in both `.md` files must resolve.

## Commit and PR

Follow repo conventions: feature branch `docs/<short-name>`, conventional commit, no `Co-Authored-By: Claude` lines, no `--no-verify`.

```bash
git checkout -b docs/screenshots-refresh-<date>
git add docs/fixtures/ docs/screenshots/ docs/user/getting-started*.md scripts/doc/
git commit -m "docs: refresh getting-started screenshots and fixture pipeline"
git push -u origin docs/screenshots-refresh-<date>
gh pr create --title "..." --body "..."
```

Wait for the user to approve the merge — never merge without explicit "merge" or "go".

## Known pitfalls

- **Playwright `fill()` vs React state**: forms with controlled inputs ignore `fill()` for validation logic. Always use the native value setter + `input` event for any input that gates a submit button. See the snippet in Phase 1 step 7.
- **Auto-restart after wizard Continue**: the welcome wizard calls `triggerSystemRestart()` once the API write succeeds. Expect a 30 to 60 second downtime on a Raspberry Pi after clicking Continue. Wait for the API to come back before proceeding.
- **Slow domopi cold start**: the first HTTP request after `docker compose up -d` can take 5 to 10 seconds. Use `--max-time 10` on `curl`, otherwise short timeouts make the readiness check appear to fail.
- **Auth required for backup upload**: `POST /api/v1/backup` requires an admin Bearer token. The fixture bakes one in so this works after restore, but the very first upload needs the admin created via the wizard.
- **FK integrity on restore**: `data_bindings.device_data_id` and `order_bindings.device_order_id` have FK constraints. Never empty `device_data` or `device_orders` in the fixture. The current script keeps them.
- **Dashboard widget field name**: in `dashboard_widgets`, the equipment reference is `equipment_id`, not `entity_id`. Filtering for deleted equipments must use that name.
- **Logout button**: in the topbar, the Log out button has no visible text, only `aria-label` (EN: "Log out", FR: "Se déconnecter"). Find it via `title` or `aria-label` attribute, not text content.
- **Em-dashes in UI**: the welcome wizard tip has em-dashes in the localized strings. Per project preferences these should be replaced (`—` to `:` or restructured). Flag any new em-dash you spot but do not silently fix them in this skill — open a separate UI ticket.

## Naming convention

| Pattern                 | When                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `<page>-<topic>-en.png` | Default for any shot with translatable UI text or user data |
| `<page>-<topic>-fr.png` | French sibling                                              |
| `<page>-<topic>.png`    | Only when the shot is truly language-neutral (rare)         |

Both `getting-started.md` and `getting-started.fr.md` must reference the same base name, with the language suffix matching the file.

## When to regenerate

Run this skill when:

- The UI changes enough that current screenshots are misleading (form layouts, sidebar items, dashboard widget styling)
- A new locale appears
- The prod data model drift breaks the existing fixture restore
- A new screenshot family must be added to the docs (extend `scripts/doc/build-fixtures.py` mapping if needed)

## Extending to other user guide pages

The pipeline already produces a populated showroom usable for capturing other pages. To add screenshots for, say, `equipments.md`:

1. Decide which equipment to focus on (the showroom has 74)
2. Add the URL to the capture script (or to the Playwright sequence)
3. Capture both `-en` and `-fr` after restoring the matching fixture
4. Edit the relevant `.md` to reference the new shots

The fixture itself already covers most equipment types (lights, shutters, gates, thermostats, sensors, pool, energy meters, weather, buttons, valves), so no fixture rebuild is needed for new pages unless the prod gains a new equipment type.
