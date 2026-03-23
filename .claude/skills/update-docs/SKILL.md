---
name: update-docs
description: Update Sowel documentation site (MkDocs Material). Use when implementing features, fixing bugs, or when user asks to update/add documentation.
user-invocable: true
argument-hint: "[page-or-topic]"
---

# Sowel Documentation Update Workflow

## Documentation Structure

The documentation site uses **MkDocs Material** and lives in the repo:

```
docs/
├── index.md                    # Home page
├── CNAME                       # Custom domain (docs.sowel.org)
├── assets/                     # Logo, favicon
├── stylesheets/extra.css       # Sowel brand colors
├── technical/                  # Technical Guide
│   ├── index.md               # Tech overview
│   ├── architecture.md        # System design, pipeline, project structure
│   ├── api-reference.md       # REST API endpoints, WebSocket events
│   ├── plugin-development.md  # Plugin creation guide
│   ├── recipe-development.md  # Recipe template guide
│   ├── data-model.md          # SQLite schema, TypeScript types
│   └── contributing.md        # Dev setup, conventions, git workflow
└── user/                       # User Guide
    ├── index.md               # User overview
    ├── getting-started.md     # Installation, first login
    ├── equipments.md          # Equipment types, bindings
    ├── dashboard.md           # Dashboard widgets, customization
    ├── zones.md               # Zones, aggregation
    ├── modes.md               # Modes, calendar
    ├── energy.md              # Energy monitoring, HP/HC
    └── remote-access.md       # Cloudflare tunnel, HTTPS
mkdocs.yml                      # Site config, navigation
```

## How to Update Documentation

### Step 1: Identify what needs updating

| Change type         | Pages to update                                                  |
| ------------------- | ---------------------------------------------------------------- |
| New API endpoint    | `technical/api-reference.md`                                     |
| New equipment type  | `user/equipments.md` + `technical/data-model.md`                 |
| New plugin          | `technical/plugin-development.md` (if patterns changed)          |
| New UI feature      | Relevant `user/*.md` page                                        |
| Architecture change | `technical/architecture.md`                                      |
| New recipe          | `technical/recipe-development.md`                                |
| New integration     | `user/getting-started.md` (config) + `technical/architecture.md` |
| Schema change       | `technical/data-model.md`                                        |

### Step 2: Update the documentation

**Rules:**

- Write in **English** only (French i18n prepared but not active)
- Use **MkDocs Material** markdown extensions:
  - Admonitions: `!!! tip`, `!!! warning`, `!!! note`, `!!! info`
  - Code blocks with language: ` ```typescript `, ` ```bash `, ` ```json `
  - Tabbed content: `=== "Tab 1"` / `=== "Tab 2"`
  - Tables for structured data
- Keep the **user guide** non-technical, task-oriented
- Keep the **technical guide** detailed with code examples

**Writing style:**

- User guide: "You can...", "To create a zone, click...", practical steps
- Technical guide: Direct, precise, with code examples and type signatures
- No emojis unless already present in the page

### Step 3: Update navigation if needed

If you added a new page, update `mkdocs.yml` nav section.

### Step 4: Verify locally

```bash
cd /Users/mchacher/Documents/01_Geekerie/Sowel
mkdocs build --strict
```

### Step 5: Commit and deploy

Documentation auto-deploys to `docs.sowel.org` via GitHub Actions when changes to `docs/` or `mkdocs.yml` are pushed to `main`.

```bash
git add docs/ mkdocs.yml
git commit -m "docs: <description of changes>"
git push
```
