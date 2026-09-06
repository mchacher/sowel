---
name: sowel-docs
description: Update Sowel documentation site (MkDocs Material). Use when implementing features, fixing bugs, or when user asks to update/add documentation.
user-invocable: true
argument-hint: "[page-or-topic]"
---

# Sowel Documentation Update Workflow

Topic to document: $ARGUMENTS

## Step 1: Identify Pages to Update

| Change type         | Pages to update                                                   |
| ------------------- | ----------------------------------------------------------------- |
| New API endpoint    | `docs/technical/api-reference.md`                                 |
| New equipment type  | `docs/user/equipments.md` + `docs/technical/data-model.md`        |
| New plugin          | `docs/technical/plugin-development.md` (if patterns changed)      |
| New UI feature      | Relevant `docs/user/*.md` page                                    |
| Architecture change | `docs/technical/architecture.md`                                  |
| New recipe          | `docs/technical/recipe-development.md`                            |
| New integration     | `docs/user/getting-started.md` + `docs/technical/architecture.md` |
| Schema change       | `docs/technical/data-model.md`                                    |

## Step 2: Read Existing Content First

**ALWAYS read the target page before editing it.** Understand the existing structure, style, and level of detail before making changes.

## Step 3: Update the Documentation

**Rules:**

- Write in **English** only
- Use MkDocs Material extensions: `!!! tip`, `!!! warning`, `!!! note`, code blocks with language, tables
- **User guide** (`docs/user/`): non-technical, task-oriented ("You can...", "To create a zone, click...")
- **Technical guide** (`docs/technical/`): detailed with code examples and type signatures
- No emojis unless already present in the page

## Step 4: Update Navigation (if new page)

If you added a new page, update `mkdocs.yml` nav section.

## Step 5: Screenshots

Screenshots live under `docs/screenshots/` and are referenced from `.md` files via `![alt](../screenshots/<name>-<lang>.png)`.

### Naming convention

`<topic>-<context>-<lang>.png` — e.g., `energy-live-en.png`, `zone-view-fr.png`. Always provide both `-en.png` and `-fr.png` and reference each from the matching locale file.

### Quality rules — non-negotiable

1. **Take screenshots on a 1920×1080 viewport with `fullPage: true`.** Existing reference screenshots (energy, getting-started) are 1920×1080. Smaller crops get scaled up by the docs theme and look pixelated. Tight element crops (`section:has(...)`) are forbidden for that reason.
2. **Show the surrounding context.** A reader landing on the page should understand where the feature lives in the UI. Capture the full zone view, not just one panel.
3. **For mobile**, use a 390×844 viewport (iPhone 13) with `fullPage: true`. The page is allowed to be tall (a scrollshot is fine).
4. **Hide live noise** before shooting: pause polling tasks, dismiss toasts, ensure the WS connection pill reads `● live` (not `○ offline`).
5. **Never shoot on a real production instance** and **never use `./scripts/run-swap.sh local`** for screenshots:
   - Real instance data leaks personal names and the actual home topology into public docs.
   - `run-swap.sh local` stops the prod container over SSH, which crashes the real home automation.
   - Use a local Docker instance and the anonymized showroom fixture instead — see "Screenshot pipeline" below.

### Screenshot pipeline (anonymized via demo instance)

Screenshots are shot on a **throwaway Sowel running in Docker on this machine**, never on a real instance. There is no demo host any more: one existed as a Raspberry Pi, and a box that has to be kept alive, reachable and up to date for something needed a few times a year meant every session began by repairing it. `docker-compose.docs.yml` at the repository root replaces it, on port 3001, with its own volumes and no Docker socket.

Only the prod backup source comes from the private ops repo (`../sowel-ops/ops.env`: `SOWEL_PROD_HOST` — see `CLAUDE.md` section "Installation-specific context"). Source it first: `source ../sowel-ops/ops.env`. Two stages:

**1. Build anonymized fixtures from a fresh prod backup**

```bash
# (a) Download a prod backup (credentials: see the private ops context)
python3 -c "
import os, urllib.request, json
prod = 'http://' + os.environ['SOWEL_PROD_HOST']
req = urllib.request.Request(prod + '/api/v1/auth/login',
  data=json.dumps({'username':'admin','password':'<prod-admin-password>'}).encode(),
  headers={'Content-Type':'application/json'}, method='POST')
tok = json.loads(urllib.request.urlopen(req).read())['accessToken']
req = urllib.request.Request(prod + '/api/v1/backup',
  headers={'Authorization':'Bearer '+tok})
open('/tmp/prod-backup.zip','wb').write(urllib.request.urlopen(req).read())
"

# (b) Run the anonymization pipeline
python3 scripts/doc/build-fixtures.py /tmp/prod-backup.zip
# Outputs /tmp/showroom-fr.zip and /tmp/showroom-en.zip with rename + translate maps applied
```

The script uses `ZONE_RENAME_FR`, `EQUIPMENT_RENAME_FR`, `DEVICE_RENAME_FR`, and the FR→EN `ZONE_TRANSLATE` / `EQUIPMENT_TRANSLATE` maps in `scripts/doc/build-fixtures.py`. If a new name appears that needs anonymization or translation, add it to the maps in the script first.

The maps are static and the installation is not, so the script **refuses to write a fixture** in which any token from `PERSONAL_TOKENS` survives. Do not work around a refusal: add the name to the right map and rebuild. Two things this caught that a zone-and-equipment pass does not:

- **Devices carry names too.** `remote_marc` and `remote_elodie` were rendered on the Devices page and in every binding list while the zone and equipment listings looked clean.
- **A French name can read as English.** An awning called `Store` sat in the EN fixture through every earlier pass. After a rebuild, list the EN fixture's zone and equipment names and read them, rather than trusting the maps to be complete.

**An inert instance cannot photograph a live one.** The shadow runs no integration (spec 124), so Energy > Live, Plugins and Devices render red banners, "no connection for N min" and offline rows: they photograph the setup, not the product. The `power` freshness window is two minutes, so there is no shooting it quickly either. Restrict a shadow shoot to structural surfaces (dashboard, edit mode, zones, modes, settings); the runtime-state pages need an instance that is actually receiving data.

**Hide the shadow banner before shooting.** It is deliberately non-dismissable, so it lands in every screenshot:

```js
await page.addStyleTag({
  content: '.bg-amber-500[role="status"][aria-live="polite"]{display:none!important}',
});
// then assert it is gone rather than trusting the injection
```

**2. Deploy fixture locally + shoot (per language)**

```bash
DOCS=http://localhost:3001

# Full reset — `down -v` wipes only this instance's volumes (own project name)
docker compose -f docker-compose.docs.yml down -v
docker compose -f docker-compose.docs.yml pull
docker compose -f docker-compose.docs.yml up -d

# Wait for the API rather than guessing a delay
until curl -sf "$DOCS/api/v1/auth/status" >/dev/null; do sleep 2; done

# Setup first admin via POST /api/v1/auth/setup, then log in for a token
# Restore showroom-fr.zip via POST /api/v1/backup (multipart) — for FR shoot
# Take FR screenshots on $DOCS (set localStorage sowel_language=fr, reload)
# Restore showroom-en.zip via POST /api/v1/backup — for EN shoot
# Take EN screenshots
```

Pin the image when documenting a specific release:
`SOWEL_DOCS_IMAGE=ghcr.io/mchacher/sowel:1.68.0 docker compose -f docker-compose.docs.yml up -d`.

Tear it down when the session is over (`down -v`); it is meant to be disposable, and leaving it running is how it drifts out of date.

### Playwright MCP recipe (preferred)

```javascript
// Desktop — fullPage at 1920×1080
mcp__playwright__browser_resize({ width: 1920, height: 1080 });
mcp__playwright__browser_navigate({ url: "http://localhost:5173/<page>" });
mcp__playwright__browser_wait_for({ time: 3 });
mcp__playwright__browser_take_screenshot({
  type: "png",
  filename: "<topic>-en.png",
  fullPage: true,
  // No `target` — we want the full page
});
```

For the language swap between `-en` and `-fr` files, switch via `localStorage.setItem("sowel_language", "en"|"fr")` then `location.reload()` and re-shoot.

### When you must crop tight

If you absolutely need a close-up of a control (e.g., to highlight a toggle button), do it on top of the wider page screenshot in a second image and label the cropped one clearly (`-detail-` infix). Never replace the wide context shot with the crop.

## Step 6: Verify

```bash
mkdocs build --strict
```

## Step 7: Commit

Documentation auto-deploys to GitHub Pages when pushed to `main`.

```bash
git add docs/ mkdocs.yml
git commit -m "docs: <description>"
```

## Documentation Structure

```
docs/
├── index.md                     # Home page
├── technical/                   # Technical Guide
│   ├── architecture.md          # System design, pipeline
│   ├── api-reference.md         # REST API, WebSocket
│   ├── plugin-development.md    # Plugin creation guide
│   ├── recipe-development.md    # Recipe template guide
│   ├── data-model.md            # SQLite schema, types
│   └── contributing.md          # Dev setup, conventions
└── user/                        # User Guide
    ├── getting-started.md       # Installation, first login
    ├── equipments.md            # Equipment types, bindings
    ├── dashboard.md             # Widgets, customization
    ├── zones.md                 # Zones, aggregation
    ├── modes.md                 # Modes, calendar
    ├── energy.md                # Energy monitoring
    └── remote-access.md         # HTTPS, tunnel
```
