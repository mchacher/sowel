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
   - Use the demo instance and the anonymized showroom fixture instead — see "Screenshot pipeline" below.

### Screenshot pipeline (anonymized via demo instance)

The demo instance hosts and the prod backup source are defined in the private ops repo (`../sowel-ops/ops.env`: `SOWEL_PROD_HOST`, `SOWEL_DEMO_SSH`, `SOWEL_DEMO_URL`, `SOWEL_DEMO_COMPOSE_DIR` — see `CLAUDE.md` section "Installation-specific context"). Source it first: `source ../sowel-ops/ops.env`. Two stages:

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

The script uses `ZONE_RENAME_FR`, `EQUIPMENT_RENAME_FR`, and the FR→EN `ZONE_TRANSLATE` / `EQUIPMENT_TRANSLATE` maps in `scripts/doc/build-fixtures.py`. If a new name appears that needs anonymization or translation, add it to the maps in the script first.

**2. Deploy fixture to demo + shoot (per language)**

```bash
# Full reset of demo
ssh "$SOWEL_DEMO_SSH" "cd $SOWEL_DEMO_COMPOSE_DIR && docker compose down -v && docker compose pull && docker compose up -d"
# Wait for /api/v1/auth/status to respond
# Setup first admin via POST /api/v1/auth/setup
# Restore showroom-fr.zip via POST /api/v1/backup (multipart) — for FR shoot
# Take FR screenshots on $SOWEL_DEMO_URL (set localStorage sowel_language=fr, reload)
# Restore showroom-en.zip via POST /api/v1/backup — for EN shoot
# Take EN screenshots
```

Demo compose file: `$SOWEL_DEMO_COMPOSE_DIR/docker-compose.yml`. Keep `image: ghcr.io/mchacher/sowel:<version>` aligned with the prod release. Demo port 3001 maps to container 3000.

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
