---
name: update-docs
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

## Step 5: Verify

```bash
mkdocs build --strict
```

## Step 6: Commit

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
