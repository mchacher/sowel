# Design Tokens

> All tokens are CSS variables. Source of truth: [tokens.css](tokens.css).
> Two themes: **Hybrid** (default) and **Dark**. Switch via `<html data-theme="hybrid|dark">`.

---

## 1. Color tokens

### 1.1 Primary — ocean blue

The Sowel signature color. Used for navigation active states, links, focus rings, and the "behaviors" panel head.

| Token     | Hybrid        | Dark          | Usage                                                   |
| --------- | ------------- | ------------- | ------------------------------------------------------- |
| `--p-50`  | `#EEF5F8`     | `#1A2A38`     | sidebar item hover/active bg, panel head bg, focus halo |
| `--p-100` | `#D9E7EF`     | `#243B4E`     | panel head border-bottom, subtle separator              |
| `--p-500` | **`#1A4F6E`** | **`#5BA5CC`** | text on actives, primary buttons, logo                  |
| `--p-600` | `#144159`     | `#82BCDD`     | primary button hover                                    |
| `--p-700` | `#0F3146`     | `#A8CEE6`     | rarely used, darker hover                               |

### 1.2 Colour roles

One colour, one meaning (spec 196). Use the Tailwind role, never a raw hue. Every text/background pair below is checked in light and dark by `ui/src/lib/color-roles.test.ts` (≥ 4.5:1 for text, ≥ 3:1 for graphics), which also fails on a retired class name.

| Role (Tailwind) | Meaning                                            | Hybrid        | Dark          | Key ratios (hybrid / dark)                  |
| --------------- | -------------------------------------------------- | ------------- | ------------- | ------------------------------------------- |
| `active`        | on or running now: fill, icon in a tile            | **`#F2C035`** | **`#F2BC6E`** | never alone as text or icon on light (1.70) |
| `active-ink`    | the word or value of something on                  | `#8A6100`     | `#F2BC6E`     | 5.54 on white, 5.12 on `active-bg` / 10.30  |
| `active-bg`     | tinted pill of something on                        | `#FFF6D6`     | `#332715`     | —                                           |
| `on-active`     | content on an amber fill (never white)             | `#1C1A14`     | `#1C1A14`     | 10.24 / 10.10                               |
| `warning`       | needs attention: dot, fill, icon                   | `#E8730C`     | `#F99549`     | 3.05 on white / 7.96                        |
| `warning-ink`   | needs attention, in words                          | `#A85500`     | `#F99549`     | 5.30 on white, 4.77 on `warning/10` / 7.96  |
| `success`       | works as expected: connected, done, mode active    | `#13794A`     | `#3DDB89`     | 5.44 on white, 4.74 on `success/10` / 9.88  |
| `error`         | fault, failure, offline, leak, destructive action  | `#B42318`     | `#F97066`     | 6.57 on white, 5.58 on `error/10` / 6.37    |
| `heat`          | heating now (alias of `error`, may diverge later)  | = `error`     | = `error`     | = `error`                                   |
| `on-status`     | text on a `success`, `error` or `warning-ink` fill | `#FFFFFF`     | `#16181E`     | 5.30–6.57 / 6.37–9.88                       |

Who may use what:

- **Amber** only for something on or running now: light, switch, plug, water heater heating, VMC, pump, compressor, appliance in a cycle, timer running, charger charging, valve open (water flows), solar command on. Not for alerts, energy, plugins, decoration, links or action buttons. On a fill, the content is `on-active`; as text, `active-ink`. The sun glyph (sunrise, sunny weather) is the one tolerated amber icon; its text stays neutral.
- **Orange** (`warning`, `warning-ink`) when something asks for attention but is not a fault: low battery, degraded, connecting, partly offline, waiting for surplus, stale reading, fallback time zone, fairly reliable forecast, unconfirmed order.
- **Red** (`error`) for faults: failure, offline, leak, smoke, critical battery, delete, restore a backup, surplus revoked. **`heat`** for heating.
- **Green** (`success`) for what works as expected: connected, online, saved, mode active, access armed. Not for open, closed, changed or solar production (energy palette).
- **Neutral** (`text`, `text-secondary`, icons `text-tertiary`) for positions and openings (open and closed alike: the word and the icon say it), meters and energy values, plugins, equipment categories, decoration.
- **Primary** for selection, links, the main action, a changed field, and motion detected (activity).
- Tinted status backgrounds stop at `/10`: at `/15` `success` and `warning-ink` drop under 4.5:1.

Raw amber scale (for fills and the tokens above; use the roles in components):

| Token     | Hybrid        | Dark          | Usage                                       |
| --------- | ------------- | ------------- | ------------------------------------------- |
| `--a-50`  | `#FFF6D6`     | `#332715`     | `active-bg`                                 |
| `--a-100` | `#FCE89A`     | `#5C3F1A`     | dimmer track tint                           |
| `--a-500` | **`#F2C035`** | **`#F2BC6E`** | `active`: icon in a tile, slider fill, glow |
| `--a-600` | `#D4A41C`     | `#FFCF8C`     | not a text colour (2.30:1 on white)         |
| `--a-ink` | `#8A6100`     | `#F2BC6E`     | `active-ink`                                |
| `--a-on`  | `#1C1A14`     | `#1C1A14`     | `on-active`                                 |

Native controls (checkboxes, radios, selects, date pickers, scrollbars) follow the theme through `color-scheme` and `accent-color: var(--color-primary)` in `ui/src/index.css`; no `accent-*` class is needed. Switches use the shared `ui/src/components/ui/Switch.tsx`: off has a visible outline (`text-tertiary`, 4.83:1) and a grey thumb, on is a primary track.

### 1.3 Neutrals — zinc scale

The neutral scale carries 95% of the UI. It is calibrated so that:

- `--n-25` and `--n-50` look distinct against pure white (`--n-0`) for sub-cat headers
- `--n-700` is the body text default
- `--n-400`–`--n-500` are for secondary text / meta

| Token     | Hybrid    | Dark      | Common usage                            |
| --------- | --------- | --------- | --------------------------------------- |
| `--n-0`   | `#FFFFFF` | `#16181E` | card backgrounds, modal body            |
| `--n-25`  | `#FAFAFA` | `#1B1D24` | sub-cat header bg, hover row bg         |
| `--n-50`  | `#F4F4F5` | `#1F2128` | page background, off-state icon bg      |
| `--n-100` | `#E9E9EB` | `#262931` | slider track, off-state pill bg         |
| `--n-200` | `#D4D4D8` | `#363941` | dividers between strip pills            |
| `--n-300` | `#A1A1AA` | `#52565F` | inactive dot, expand chevron            |
| `--n-400` | `#71717A` | `#7E828B` | meta text, table column header          |
| `--n-500` | `#52525B` | `#9CA0AA` | sidebar item text default, icon strokes |
| `--n-600` | `#3F3F46` | `#C7C9CF` | hover text, button icon                 |
| `--n-700` | `#27272A` | `#E2E3E7` | body text default                       |
| `--n-800` | `#18181B` | `#F4F5F8` | titles, values, emphasis                |

### 1.4 Semantic colors

These are NOT decorative. Each maps to a specific state.

| Token group   | Role            | Used for                                                   |
| ------------- | --------------- | ---------------------------------------------------------- |
| `--green-*`   | `success`       | `Calme` motion pill, mode actif badge, "Connecté" pill     |
| `--info-*`    | informational   | temperature/humidity/lux sensors, sparklines               |
| `--orange-*`  | `warning`       | attention: low battery, connecting, waiting, stale reading |
| `--red-*`     | `error`, `heat` | faults, smoke/leak alerts, delete buttons; heating         |
| `--a-*`       | `active`        | something on or running now (see §1.2)                     |
| `--on-status` | `on-status`     | text on a status fill                                      |

```
--green-50:#E6F7EE   --green-500:#13794A   --green-700:#0E6B3F   (Hybrid)
--info-50:#E0EFFA    --info-500:#247EB5
--orange-50:#FDF1E7  --orange-500:#E8730C  --orange-700:#A85500
--red-50:#FBE9E1     --red-500:#B42318
```

### 1.5 Equipment category tints

Used **only** on equipment row icons (`.eq__icon--{type}`). They give a glanceable visual cue per category. **Do not propagate** these colors to category headers (the user explicitly rejected that — sub-cat headers stay neutral).

| Type     | `--{type}-50`  | `--{type}-500`  | Hex (Hybrid)          |
| -------- | -------------- | --------------- | --------------------- |
| Shutters | `--shutter-50` | `--shutter-500` | `#E8EBEE` / `#4F5763` |
| Sensors  | `--sensor-50`  | `--sensor-500`  | `#EBF2EC` / `#4F7559` |
| Media    | `--media-50`   | `--media-500`   | `#EAE9F2` / `#5759A5` |

### 1.6 Borders & lines

| Token      | Hybrid               | Dark                    | Usage                                                     |
| ---------- | -------------------- | ----------------------- | --------------------------------------------------------- |
| `--line`   | `rgba(24,24,27,.08)` | `rgba(255,255,255,.06)` | row dividers, panel borders, dividers between strip pills |
| `--line-2` | `rgba(24,24,27,.14)` | `rgba(255,255,255,.14)` | group dividers (stronger), modal section breaks           |

---

## 2. Typography tokens

### 2.1 Font families

| Token         | Value                                                             | Used for                                                 |
| ------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `--font-body` | `'Inter Variable', 'Inter', system-ui, -apple-system, sans-serif` | All UI text                                              |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace`                       | Logs, JSON, identifiers, versions, codes and code fields |

Inter is the variable build (`@fontsource-variable/inter/opsz.css`): every weight is real, and the optical-size axis gives large sizes the display cut. Fontsource registers it as **`'Inter Variable'`**; a stack that starts with `'Inter'` silently falls back to `system-ui`. JetBrains Mono is loaded at 400 only.

Weights: 400, 500 and 600. There is no 700 in the interface (`font-bold` became `font-semibold`); the only exception is the « SOWEL » wordmark in Nunito 800.

The text of a number (separators, unit spacing, precision per unit) comes from `ui/src/lib/format.ts`, never from `toFixed` (spec 196).

**Numbers are Inter, not mono** (spec 196, slice 5b). A value, a time, a duration or a counter is set in Inter with `tabular-nums`, so its digits keep a fixed width and the value does not jump when it changes. JetBrains Mono is kept for what a person reads character by character or copies: logs, raw JSON, identifiers (aliases, data keys, topics, IEEE addresses), versions, codes and tokens, and the inputs that take code (topic, path, URL, template). It stays at 400: no `font-semibold` on mono, which would be a synthesised bold.

**Labels are sentence case** (spec 196, slice 5b). Size and weight carry the hierarchy, not capitals and letter-spacing. Uppercase is used in one place, the column headers of a table (`text-caption font-semibold uppercase tracking-[0.04em]`); an ESLint rule rejects `uppercase` anywhere else. The roles:

| Role                          | Classes                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Navigation entry              | `text-body font-medium`                                                                            |
| Panel or section title        | `text-lead font-semibold text-text`                                                                |
| Category in a list            | `text-small font-semibold text-text-secondary`, counter `text-micro text-text-tertiary`            |
| Form field label              | `FIELD_LABEL` (`ui/src/components/ui/text-roles.ts`): `text-small font-medium text-text-secondary` |
| Caption over a measured value | `text-caption text-text-tertiary`                                                                  |
| Pill or badge                 | `text-caption font-medium`                                                                         |
| Table column header           | `text-caption font-semibold uppercase tracking-[0.04em] text-text-tertiary`                        |

### 2.2 Type scale

Seven text steps and one value size (spec 196). Defined as `--fs-*` in `tokens.css` and exposed as Tailwind utilities by `ui/src/index.css` (`@theme`). `text-micro` … `text-value` set the **size only**: the line height is the 20 px inherited from `body`, or a `leading-*` class. Line heights per step were left out on purpose, so the move to the scale keeps every row and button its height.

| Utility        | Size  | Use                                                                      |
| -------------- | ----- | ------------------------------------------------------------------------ |
| `text-micro`   | 11 px | Chart ticks, timestamps, small unit, counter. Never a sentence. Minimum. |
| `text-caption` | 12 px | Secondary info, help under a field, table header, pill                   |
| `text-small`   | 13 px | Field label, button, dense list row, breadcrumb, sub-navigation          |
| `text-body`    | 14 px | Running text (the `body` default), equipment name, main navigation       |
| `text-lead`    | 16 px | Panel, section or card title                                             |
| `text-title`   | 20 px | Sheet or modal title; a value in a detail row                            |
| `text-display` | 28 px | Page title; a card's main value                                          |
| `text-value`   | 40 px | Headline value: thermostat, mobile weather, battery                      |

Charts take numbers, not classes: `CHART_TICK_FONT` (11) and `CHART_TOOLTIP_FONT` (12) in `ui/src/lib/chart-font.ts`.

An ESLint rule (`ui/eslint.config.js`) rejects arbitrary sizes — `text-[13px]`, `text-[.82rem]`, `text-[clamp(…)]` — and a literal `fontSize` in a style or chart prop. A colour in brackets (`text-[var(--n-700)]`) is fine. SVG illustrations (`WidgetIcons.tsx`, the logo) keep their own `fontSize` attributes. The one fluid size (the dashboard weather tile, sized to its container) carries an explained `eslint-disable`.

### 2.3 Text features (applied via tokens.css)

- **Tabular nums** (`tabular-nums`, or `font-feature-settings: "tnum" 1`) on every numeric container so values don't shift when their digit count changes. This is what keeps Inter numbers steady; it is not a reason to use mono.
- **Inter contextual ligatures** (`cv11`, `ss01`) on all body text for the "modern Inter" feel.
- **Letter-spacing** is tight on titles (`-0.022em` to `-0.03em`), `0.04em` on table column headers, and normal everywhere else.

---

## 3. Spacing scale

Base unit: **4 px**.

| Token   | Value | Used for                          |
| ------- | ----- | --------------------------------- |
| `--s-1` | 4 px  | Tight gaps in pills, icon-to-text |
| `--s-2` | 8 px  | Row gap inside modal sections     |
| `--s-3` | 12 px | Card padding, button padding-x    |
| `--s-4` | 16 px | Panel padding, gap between cards  |
| `--s-5` | 20 px | Section padding, hero padding-x   |
| `--s-6` | 24 px | Large gap, modal padding          |
| `--s-8` | 32 px | Page margin top/bottom            |

Most components use **rem values directly** (e.g. `padding: .55rem 1.1rem`) instead of these tokens. The token scale exists for future migration to a more rigorous system; for now it documents the conventional unit ladder.

---

## 4. Radius tokens

| Token      | Value  | Used for                               |
| ---------- | ------ | -------------------------------------- |
| `--r-xs`   | 4 px   | Chip-state badges, small tags          |
| `--r-sm`   | 6 px   | Buttons, input fields, icon containers |
| `--r-md`   | 8 px   | Cards, strip, modals                   |
| `--r-lg`   | 12 px  | Panels, hero                           |
| `--r-full` | 999 px | Pills (`Calme · 39 min`, `Connecté`)   |

**Note**: Production Dashboard widgets currently use an arbitrary `border-radius: 10px`. The design system targets `--r-md` (8 px) for full alignment; production may keep 10 px transitionally and snap to 8 px during the next refactor. See [components/dashboard-widget.md](components/dashboard-widget.md) and [migration.md](migration.md).

---

## 5. Shadow tokens (elevation)

| Token    | Hybrid value     | Used for                              |
| -------- | ---------------- | ------------------------------------- |
| `--sh-1` | subtle, 1–3 px   | Default panels, card hover            |
| `--sh-2` | medium, 4–14 px  | Pill bar (variant A), modal head hint |
| `--sh-3` | strong, 24–56 px | Modal, dropdown, overlay              |

Each shadow has a complementary set in dark theme that uses near-black tints instead of slate-tinted ones.

---

## 6. Motion tokens

| Token           | Value                      | Used for                                 |
| --------------- | -------------------------- | ---------------------------------------- |
| Duration short  | `140 ms`                   | Hover state changes (bg, color)          |
| Duration medium | `240 ms`                   | Theme switch transitions                 |
| Duration reveal | `520 ms`                   | Staggered `rise` animation at page load  |
| Easing standard | `cubic-bezier(.2,.7,.2,1)` | Reveal `rise` animation, scale on action |

Keyframes are declared in [tokens.css](tokens.css):

- `rise` — opacity 0 → 1, translateY 10 → 0
- `glow` — concentric box-shadow ripple on light-on icons
- `pulseAlert` — concentric red ripple on alert pills
- `connPing` — ping ring on Connecté dot

All animations honor `prefers-reduced-motion: reduce`.

---

## 7. Z-index registry

The system uses **5 layers maximum**.

| Layer          | Range           | Used for                                     |
| -------------- | --------------- | -------------------------------------------- |
| Base           | `0`             | All content by default                       |
| Sticky topbar  | `10`            | Topbar that stays on top during inner scroll |
| Sticky picker  | `100`           | The theme/palette picker bar at the very top |
| Modal backdrop | `200`           | Behind a modal                               |
| Modal          | `210`           | The modal card itself                        |
| Toast          | `300` (planned) | Future toast notifications                   |

Components **never** declare arbitrary z-index values. Pick from this registry.

---

## 8. Conversion notes for migration

The current production codebase uses Tailwind utility classes with semantic class names (`bg-surface`, `text-text-tertiary`, etc.) backed by a Tailwind config. To migrate:

| Tailwind semantic                 | Tokens.css equivalent                     |
| --------------------------------- | ----------------------------------------- |
| `bg-surface`                      | `var(--n-0)`                              |
| `bg-border-light` / `bg-bg`       | `var(--n-25)`                             |
| `text-text`                       | `var(--n-700)`                            |
| `text-text-secondary`             | `var(--n-600)`                            |
| `text-text-tertiary`              | `var(--n-400)`                            |
| `border-border`                   | `var(--line-2)`                           |
| `border-border-light`             | `var(--line)`                             |
| `text-primary` / `bg-primary`     | `var(--p-500)`                            |
| `bg-primary/8`                    | `var(--p-50)`                             |
| `bg-active` / `text-active-ink`   | `var(--a-500)` / `var(--a-ink)`           |
| `bg-active-bg` / `text-on-active` | `var(--a-50)` / `var(--a-on)`             |
| `bg-warning` / `text-warning-ink` | `var(--orange-500)` / `var(--orange-700)` |
| `text-success` / `bg-success/10`  | `var(--green-500)` / `var(--green-50)`    |
| `text-error` / `bg-error/10`      | `var(--red-500)` / `var(--red-50)`        |
| `text-heat` / `text-on-status`    | `var(--red-500)` / `var(--on-status)`     |

See [migration.md](migration.md) for the broader strategy.

---

## 9. Changelog

| Date       | Change                                                                              |
| ---------- | ----------------------------------------------------------------------------------- |
| 2026-05-13 | Initial extraction from polished.html (v1.0)                                        |
| 2026-11-07 | Inter variable, type scale `text-micro` … `text-value`, no 700 (spec 196, slice 5a) |
| 2026-11-07 | Colour roles: amber = on, orange = attention, red = fault; no light tint (slice 4)  |
