# Design Tokens

> All tokens are CSS variables. Source of truth: [tokens.css](tokens.css).
> Two themes: **Hybrid** (default) and **Dark**. Switch via `<html data-theme="hybrid|dark">`.

---

## 1. Color tokens

### 1.1 Primary — ocean blue

The Sowel signature color. Used for navigation active states, links, focus rings, and the "behaviors" panel head.

| Token            | Hybrid        | Dark          | Usage                                                          |
| ---------------- | ------------- | ------------- | -------------------------------------------------------------- |
| `--p-50`         | `#EEF5F8`     | `#1D303D`     | sidebar item hover/active bg, panel head bg, focus halo        |
| `--p-100`        | `#D9E7EF`     | `#243B4E`     | panel head border-bottom, subtle separator                     |
| `--p-500`        | **`#1A4F6E`** | **`#5BA5CC`** | ink: links, icons, selected text, logo                         |
| `--p-600`        | `#144159`     | `#82BCDD`     | ink hover (`hover:text-primary-hover`)                         |
| `--p-700`        | `#0F3146`     | `#A8CEE6`     | rarely used, darker hover                                      |
| `--p-fill`       | `#1A4F6E`     | **`#2B7299`** | fill: primary button, selected segment, checked box, switch on |
| `--p-fill-hover` | `#144159`     | `#276B8F`     | fill hover                                                     |
| `--p-on`         | `#FFFFFF`     | `#FFFFFF`     | text and icons on the fill                                     |
| `--p-mid`        | `#7FB8D4`     | `#7FB8D4`     | logo mid-blue (smile, eyes), soft border of a selection header |

**Fill and ink are two roles** (spec 196, slice 4b). In light they are the same ocean; in dark the ink turns light blue so links and icons read on the night surface, while the fill stays a deep ocean that white text reads on (5.29:1, 5.86:1 hovered; the light blue under white was 2.73:1). In components: `bg-primary-fill text-white hover:bg-primary-fill-hover` for anything that carries text or an icon, `border-primary-fill` on a checked box; `bg-primary` only for a dot, a bar or a line, never under text. `color-roles.test.ts` fails on `bg-primary` with `text-white` and on `bg-primary-hover`.

### 1.2 Colour roles

One colour, one meaning (spec 196). Use the Tailwind role, never a raw hue. Every text/background pair below is checked in light and dark by `ui/src/lib/color-roles.test.ts` (≥ 4.5:1 for text, ≥ 3:1 for graphics), which also fails on a retired class name.

| Role (Tailwind) | Meaning                                            | Hybrid        | Dark          | Key ratios (hybrid / dark)                    |
| --------------- | -------------------------------------------------- | ------------- | ------------- | --------------------------------------------- |
| `active`        | on or running now: fill, icon in a tile            | **`#F2C035`** | **`#F2BC6E`** | never alone as text or icon on light (1.70)   |
| `active-ink`    | the word or value of something on                  | `#8A6100`     | `#F2BC6E`     | 5.54 on white, 5.12 on `active-bg` / 9.30     |
| `active-bg`     | tinted pill of something on                        | `#FFF6D6`     | `#332715`     | —                                             |
| `on-active`     | content on an amber fill (never white)             | `#1C1A14`     | `#1C1A14`     | 10.24 / 10.10                                 |
| `warning`       | needs attention: dot, fill, icon                   | `#E8730C`     | `#F99549`     | 3.05 on white / 7.18                          |
| `warning-ink`   | needs attention, in words                          | `#A85500`     | `#F99549`     | 5.30 on white, 4.77 on `warning/10` / 7.18    |
| `success`       | works as expected: connected, done, mode active    | `#13794A`     | `#3DDB89`     | 5.44 on white, 4.74 on `success/10` / 8.91    |
| `error`         | fault, failure, offline, leak, destructive action  | `#B42318`     | `#F97066`     | 6.57 on white, 5.58 on `error/10` / 5.75      |
| `heat`          | heating now (alias of `error`, may diverge later)  | = `error`     | = `error`     | = `error`                                     |
| `on-status`     | text on a `success`, `error` or `warning-ink` fill | `#FFFFFF`     | `#0E191F`     | 5.30–6.57 / 6.40–9.93                         |
| `info`          | informational: icon, fill                          | `#247EB5`     | `#5DA8F0`     | 4.44 on white (graphic) / 6.35                |
| `info-ink`      | informational, in words: humidity, contacts        | `#1D6A9A`     | `#5DA8F0`     | 5.87 on white, 5.17 on `info/10` / 5.37       |
| `primary-fill`  | primary button, selected segment, switch on        | `#1A4F6E`     | `#2B7299`     | white on it 8.80 / 5.29; 3.03 on dark surface |
| `illu`          | dashboard illustration at rest                     | `#1A4F6E`     | `#7FB8D4`     | 8.80 / 7.40 on the surface                    |

Who may use what:

- **Amber** only for something on or running now: light, switch, plug, water heater heating, VMC, pump, compressor, appliance in a cycle, timer running, charger charging, valve open (water flows), solar command on. Not for alerts, energy, plugins, decoration, links or action buttons. On a fill, the content is `on-active`; as text, `active-ink`. The sun glyph (sunrise, sunny weather) is the one tolerated amber icon; its text stays neutral.
- **Orange** (`warning`, `warning-ink`) when something asks for attention but is not a fault: low battery, degraded, connecting, partly offline, waiting for surplus, stale reading, fallback time zone, fairly reliable forecast, unconfirmed order.
- **Red** (`error`) for faults: failure, offline, leak, smoke, critical battery, delete, restore a backup, surplus revoked. **`heat`** for heating.
- **Green** (`success`) for what works as expected: connected, online, saved, mode active, access armed. Not for open, closed, changed or solar production (energy palette).
- **Neutral** (`text`, `text-secondary`, icons `text-tertiary`) for positions and openings (open and closed alike: the word and the icon say it), meters and energy values, plugins, equipment categories, decoration.
- **Primary** for selection, links, the main action, a changed field, and motion detected (activity). A filled control takes `primary-fill` (see §1.1), text and icons take `primary`.
- **Info** (`info`, `info-ink`) for informational categories (humidity, contacts) in the device data table.
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

Native controls (checkboxes, radios, selects, date pickers, scrollbars) follow the theme through `color-scheme` and `accent-color: var(--color-primary)` in `ui/src/index.css`; no `accent-*` class is needed. Switches use the shared `ui/src/components/ui/Switch.tsx`: off has a visible outline (`text-tertiary`, 5.37:1) and a grey thumb, on is a `primary-fill` track (white thumb 5.29:1 in dark).

### 1.3 Neutrals — ocean-tinted

The neutral scale carries 95% of the UI (spec 196, slice 7a). It is generated in OKLCH on the brand hue (238.5°): each step keeps the lightness of the old Tailwind zinc step it replaces, so the contrasts stay where they were, and the chroma fades towards both ends. Light has a faint blue cast; dark is the **ocean night**, the same hue at night.

- The page is `--n-50` (`bg-background`), the cards are `--n-0` (`bg-surface`). Cards are lighter than the page in **both** themes (1.13:1 light, 1.11:1 dark): in dark the elevation is a lighter tone, not a shadow.
- `--n-25` is a pale blue band inside a white card in light (Maison category headers); in dark it equals the page, so the same band reads as a well.
- `--n-700` is the body text, `--n-600` the secondary text, `--n-400` the tertiary text.

| Token     | Hybrid    | Dark      | Common usage                            |
| --------- | --------- | --------- | --------------------------------------- |
| `--n-0`   | `#FFFFFF` | `#17232B` | card surface, sidebar, top bar, modal   |
| `--n-25`  | `#F6FAFC` | `#0E191F` | sub-cat header bg, hover row bg         |
| `--n-50`  | `#ECF2F7` | `#0E191F` | page background, off-state icon bg      |
| `--n-100` | `#E0E8ED` | `#212D35` | slider track, off-state pill bg         |
| `--n-200` | `#CCD5DB` | `#303C45` | dividers between strip pills            |
| `--n-300` | `#9AA4AB` | `#515D65` | inactive dot, expand chevron (no text)  |
| `--n-400` | `#626C73` | `#939DA4` | tertiary text: meta, table column head  |
| `--n-500` | `#4A545B` | `#A8B1B7` | sidebar item text default, icon strokes |
| `--n-600` | `#394249` | `#C9CFD3` | secondary text, button icon             |
| `--n-700` | `#21282D` | `#E4E8EB` | body text default                       |
| `--n-800` | `#11171B` | `#F1F4F6` | titles, values, emphasis                |

Text on the card surface and on the page, as checked by `color-roles.test.ts` (≥ 4.5:1 for all three):

| Text                     | Hybrid surface / page | Dark surface / page |
| ------------------------ | --------------------- | ------------------- |
| `text` (`--n-700`)       | 14.94 / 13.24         | 12.99 / 14.47       |
| `text-secondary` (n-600) | 10.25 / 9.08          | 10.18 / 11.34       |
| `text-tertiary` (n-400)  | 5.37 / 4.76           | 5.79 / 6.45         |

Before slice 7a the tertiary text failed on the page in both themes (4.40 light, 4.37 dark) and the dark cards (`#16181E`) were darker than the page. The selection tint `--p-50` moved to `#1D303D` in dark: the old `#1A2A38` was 1.09:1 on the new surface, invisible; the new one is 1.18:1, with the primary ink on it at 4.99:1. In light `--p-50` (`#EEF5F8`) is 1.10:1 on a card but 1.02:1 on the page, so a selection always sits on a card or the sidebar, never on the bare page.

The PWA splash (`ui/index.html`), the dark `theme-color` and the manifest `background_color` (`ui/vite.config.ts`) take the page colour `--n-50` of each theme; the test checks they match.

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
--info-50:#E0EFFA    --info-500:#247EB5    --info-700:#1D6A9A
--orange-50:#FDF1E7  --orange-500:#E8730C  --orange-700:#A85500
--red-50:#FBE9E1     --red-500:#B42318
```

### 1.5 Equipment category tints

Used **only** on equipment row icons (`.eq__icon--{type}`). They give a glanceable visual cue per category. **Do not propagate** these colors to category headers (the user explicitly rejected that — sub-cat headers stay neutral).

| Type     | `--{type}-50`  | `--{type}-500`  | Hex (Hybrid)          | Hex (Dark)            |
| -------- | -------------- | --------------- | --------------------- | --------------------- |
| Shutters | `--shutter-50` | `--shutter-500` | `#E8EBEE` / `#4F5763` | `#222C3A` / `#94A3B8` |
| Sensors  | `--sensor-50`  | `--sensor-500`  | `#EBF2EC` / `#4F7559` | `#203024` / `#6BCF8C` |
| Media    | `--media-50`   | `--media-500`   | `#EAE9F2` / `#5759A5` | `#282A3A` / `#9D9FE6` |

The dark squares take the lightness of `--n-100` with the category's hue: 1.14:1 on the ocean night card, the icon at 5.5:1 or more on them (`ui/src/lib/color-roles.test.ts`).

### 1.5b Illustrations

The dashboard illustrations (`WidgetIcons.tsx`, `AwningIcon.tsx`, `EvCarGauge.tsx`) take these tokens, never a hex and never a filter: the old `.dark svg { filter: brightness(1.6) }` turned the ocean strokes into cyan (`#5BA5CC × 1.6 = #92FFFF`). At rest an illustration is `text-illu` (`currentColor`); on or running it is `text-active` (amber), heating `text-heat`, fault `text-error`.

| Token           | Hybrid    | Dark      | Usage                                         |
| --------------- | --------- | --------- | --------------------------------------------- |
| `--illu-ink`    | `#1A4F6E` | `#7FB8D4` | strokes at rest (`text-illu`), awning stripes |
| `--illu-ink-2`  | `#13405A` | `#5BA5CC` | darker end of a gradient (awning cassette)    |
| `--illu-fill`   | `#E6F0F6` | `#1D303D` | pale parts: awning stripes                    |
| `--illu-fill-2` | `#D6E5EF` | `#243B4E` | pale end of a gradient                        |
| `--illu-water`  | `#247EB5` | `#5DA8F0` | water seen in a pipe (water valve open)       |

A part painted "white" in light (valve body, pipe) takes `var(--color-surface)`, so it is the card colour in dark.

### 1.6 Borders & lines

| Token      | Hybrid               | Dark                    | Usage                                              |
| ---------- | -------------------- | ----------------------- | -------------------------------------------------- |
| `--line`   | `rgba(17,23,27,.08)` | `rgba(255,255,255,.06)` | row dividers, dividers between strip pills         |
| `--line-2` | `rgba(17,23,27,.14)` | `rgba(255,255,255,.14)` | field and secondary-button borders, group dividers |

**A card has no border; a field has one** (spec 196, decision pr7-bordures). Lines separate rows inside a card, outline fields, secondary buttons, chart tooltips, menus and other floating layers. They never draw a card's edge: see §5.

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

**Page title.** The `h1` element is styled once, in `ui/src/index.css`: 22 px below `lg`, 28 px (`--fs-display`) from `lg`, weight 600, `-0.015em`. It holds the page name only, with no icon before it, and an optional one-line summary under it (spec 196, decision pr6-h1). Top-level pages hide it visually below `lg` (`TOP_LEVEL_H1` in `ui/src/components/layout/page-title.ts`, `sr-only lg:not-sr-only`): the compact top bar names the page there. What edits or stands beside a title (the device name input) takes the same look with the `text-h1` utility.

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

Three radii and full (spec 196, decision pr7-rayons). They replaced twelve hand-picked values from 1 to 16 px.

| Token      | Value  | Tailwind       | Used for                                                                      |
| ---------- | ------ | -------------- | ----------------------------------------------------------------------------- |
| `--r-sm`   | 6 px   | `rounded-sm`   | Controls: buttons, fields, chips, icon buttons, segmented controls, skeletons |
| `--r-md`   | 10 px  | `rounded-md`   | Cards, dashboard tiles, rows, panels, wells, popovers, tooltips, icon squares |
| `--r-lg`   | 16 px  | `rounded-lg`   | Modals, bottom sheets (`rounded-t-lg`), the slide-to-confirm track            |
| `--r-full` | 999 px | `rounded-full` | Switches, avatars, dots, status pills                                         |
| `--r-xs`   | 2 px   | `rounded-xs`   | Chart bars and legend swatches only                                           |

`ui/src/index.css` binds Tailwind's `--radius-*` to these and removes the other steps (`rounded-xl` draws nothing). A bare `rounded`, `rounded-[Npx]` or a removed step is rejected by eslint. A thumb inside a track takes the next step down (the slide thumb is `rounded-md` in a `rounded-lg` track).

---

## 5. Shadow tokens (elevation)

| Token       | Hybrid value     | Dark       | Tailwind    | Used for                                      |
| ----------- | ---------------- | ---------- | ----------- | --------------------------------------------- |
| `--sh-1`    | subtle, 1–3 px   | near-black | `shadow-sm` | —                                             |
| `--sh-card` | `var(--sh-1)`    | `none`     | (in `card`) | Every card                                    |
| `--sh-2`    | medium, 4–14 px  | near-black | `shadow-md` | Hover on a clickable card, chart tooltips     |
| `--sh-3`    | strong, 24–56 px | near-black | `shadow-lg` | Modals, bottom sheets, menus, pickers, toasts |

### 5.1 Cards, wells and floating layers

- **Card**: one class, `card` (`@utility card` in `ui/src/index.css`): the surface, `rounded-md`, `--sh-card`, no border. In light it floats on the tinted page (`--n-50`) with a soft shadow; in dark the surface is lighter than the page and the tone alone lifts it. Add padding and layout classes beside it (`card p-4 mb-6`). A clickable card lifts on hover (`hover:shadow-md`), it does not draw a border.
- **Well**: a group inside a card (a list of slots, local backups, a flow diagram node, a form opened in a row) is sunken, never a second card: `bg-background rounded-md`, no border, no shadow.
- **Modal and sheet**: `bg-surface rounded-lg shadow-lg` (`rounded-t-lg` for a bottom sheet), no border.
- **Keep their border**: fields (`input`, `select`, `textarea`), secondary buttons, a selectable option whose border shows the selection, chart tooltips, menus, pickers and toasts that float over any content, a dashed empty state, and the log viewer.
- **Not cards**: the sidebar and the top bar keep their dividing line.

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

| Tailwind semantic                     | Tokens.css equivalent                     |
| ------------------------------------- | ----------------------------------------- |
| `bg-surface`                          | `var(--n-0)`                              |
| `bg-border-light` / `bg-bg`           | `var(--n-25)`                             |
| `text-text`                           | `var(--n-700)`                            |
| `text-text-secondary`                 | `var(--n-600)`                            |
| `text-text-tertiary`                  | `var(--n-400)`                            |
| `border-border`                       | `var(--line-2)`                           |
| `border-border-light`                 | `var(--line)`                             |
| `text-primary` / `bg-primary`         | `var(--p-500)` (ink: dot, bar, line)      |
| `bg-primary-fill` / `text-on-primary` | `var(--p-fill)` / `var(--p-on)`           |
| `text-info` / `text-info-ink`         | `var(--info-500)` / `var(--info-700)`     |
| `text-illu`                           | `var(--illu-ink)`                         |
| `bg-primary/8`                        | `var(--p-50)`                             |
| `bg-active` / `text-active-ink`       | `var(--a-500)` / `var(--a-ink)`           |
| `bg-active-bg` / `text-on-active`     | `var(--a-50)` / `var(--a-on)`             |
| `bg-warning` / `text-warning-ink`     | `var(--orange-500)` / `var(--orange-700)` |
| `text-success` / `bg-success/10`      | `var(--green-500)` / `var(--green-50)`    |
| `text-error` / `bg-error/10`          | `var(--red-500)` / `var(--red-50)`        |
| `text-heat` / `text-on-status`        | `var(--red-500)` / `var(--on-status)`     |

See [migration.md](migration.md) for the broader strategy.

---

## 9. Changelog

| Date       | Change                                                                              |
| ---------- | ----------------------------------------------------------------------------------- |
| 2026-05-13 | Initial extraction from polished.html (v1.0)                                        |
| 2026-11-07 | Inter variable, type scale `text-micro` … `text-value`, no 700 (spec 196, slice 5a) |
| 2026-11-07 | Colour roles: amber = on, orange = attention, red = fault; no light tint (slice 4)  |
| 2026-11-07 | Radii 6 / 10 / 16, cards without border (`card`), wells, dark category tints (7b)   |
