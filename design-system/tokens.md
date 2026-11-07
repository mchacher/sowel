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

### 1.2 Accent — Sowel amber/yellow

**Rule**: amber is reserved for "a light is currently on". Never use amber for category headers, panel borders, or call-to-action buttons. The accent must point at _live state_, not decoration.

| Token     | Hybrid        | Dark          | Usage                                         |
| --------- | ------------- | ------------- | --------------------------------------------- |
| `--a-50`  | `#FFF6D6`     | `#332715`     | light-on icon bg tint, alarm pill bg          |
| `--a-100` | `#FCE89A`     | `#5C3F1A`     | dimmer track tint                             |
| `--a-500` | **`#F2C035`** | **`#F2BC6E`** | light-on icon fg, slider knob, power-btn on   |
| `--a-600` | `#D4A41C`     | `#FFCF8C`     | dimmer value text ("4 %"), power-btn on hover |

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
| `--n-400` | `#71717A` | `#7E828B` | meta text, label uppercase              |
| `--n-500` | `#52525B` | `#9CA0AA` | sidebar item text default, icon strokes |
| `--n-600` | `#3F3F46` | `#C7C9CF` | hover text, button icon                 |
| `--n-700` | `#27272A` | `#E2E3E7` | body text default                       |
| `--n-800` | `#18181B` | `#F4F5F8` | titles, values, emphasis                |

### 1.4 Semantic colors

These are NOT decorative. Each maps to a specific state.

| Token group | Color                                 | Used for                                                                 |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `--green-*` | success                               | `Calme` motion pill, mode actif badge, "Connecté" pill, recipe toggle ON |
| `--info-*`  | informational                         | temperature/humidity/lux sensors, sparklines                             |
| `--red-*`   | error / alert                         | open door/window pills, smoke/leak alerts, delete buttons                |
| `--a-*`     | live light (already documented above) | the on-state of any light                                                |

```
--green-50:#E6F7EE  --green-500:#1FA260  --green-700:#0E6B3F   (Hybrid)
--info-50:#E0EFFA   --info-500:#247EB5
--red-50:#FBE9E1    --red-500:#C7522E
```

### 1.5 Equipment category tints

Used **only** on equipment row icons (`.eq__icon--{type}`). They give a glanceable visual cue per category. **Do not propagate** these colors to category headers (the user explicitly rejected that — sub-cat headers stay neutral).

| Type         | `--{type}-50`  | `--{type}-500`  | Hex (Hybrid)          |
| ------------ | -------------- | --------------- | --------------------- |
| Lights (off) | `--light-50`   | `--light-500`   | `#FFF6D6` / `#F2C035` |
| Shutters     | `--shutter-50` | `--shutter-500` | `#E8EBEE` / `#4F5763` |
| Sensors      | `--sensor-50`  | `--sensor-500`  | `#EBF2EC` / `#4F7559` |
| Media        | `--media-50`   | `--media-500`   | `#EAE9F2` / `#5759A5` |

### 1.6 Borders & lines

| Token      | Hybrid               | Dark                    | Usage                                                     |
| ---------- | -------------------- | ----------------------- | --------------------------------------------------------- |
| `--line`   | `rgba(24,24,27,.08)` | `rgba(255,255,255,.06)` | row dividers, panel borders, dividers between strip pills |
| `--line-2` | `rgba(24,24,27,.14)` | `rgba(255,255,255,.14)` | group dividers (stronger), modal section breaks           |

---

## 2. Typography tokens

### 2.1 Font families

| Token         | Value                                           | Used for                       |
| ------------- | ----------------------------------------------- | ------------------------------ |
| `--font-body` | `'Inter', system-ui, -apple-system, sans-serif` | All UI text                    |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace`     | All numbers, timestamps, codes |

The text of a number (separators, unit spacing, precision per unit) comes from `ui/src/lib/format.ts`, never from `toFixed` (spec 196).

### 2.2 Type scale (no tokens — used inline)

The scale is small and informal. Sowel uses ~10 sizes total. They are declared inline because the system is too narrow to justify named tokens.

| Size               | Where it appears                        |
| ------------------ | --------------------------------------- |
| `2.6rem` (~42 px)  | Zone hero title (`Séjour`)              |
| `1.2rem`           | Timeline / page section titles          |
| `0.98rem`          | Strip pill primary value                |
| `0.95rem`          | Lead text under hero                    |
| `0.88rem`          | Equipment / mode / recipe row name      |
| `0.82rem`          | Action button label, sub-line meta      |
| `0.78rem`          | Modal body, table cell                  |
| `0.72rem`          | Pill secondary text, panel sub          |
| `0.66rem`–`0.7rem` | Uppercase labels (panel head, cat-head) |
| `0.6rem`–`0.62rem` | Counts, tiny tags                       |

### 2.3 Text features (applied via tokens.css)

- **Tabular nums** (`font-feature-settings: "tnum" 1`) on every numeric container so values don't shift when their digit count changes.
- **Inter contextual ligatures** (`cv11`, `ss01`) on all body text for the "modern Inter" feel.
- **Letter-spacing** is tight on titles (`-0.022em` to `-0.03em`) and wide on uppercase labels (`0.12em`–`0.14em`).

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

| Tailwind semantic                | Tokens.css equivalent                  |
| -------------------------------- | -------------------------------------- |
| `bg-surface`                     | `var(--n-0)`                           |
| `bg-border-light` / `bg-bg`      | `var(--n-25)`                          |
| `text-text`                      | `var(--n-700)`                         |
| `text-text-secondary`            | `var(--n-600)`                         |
| `text-text-tertiary`             | `var(--n-400)`                         |
| `border-border`                  | `var(--line-2)`                        |
| `border-border-light`            | `var(--line)`                          |
| `text-primary` / `bg-primary`    | `var(--p-500)`                         |
| `bg-primary/8`                   | `var(--p-50)`                          |
| `text-accent` / `bg-accent`      | `var(--a-500)` / `var(--a-50)`         |
| `text-success` / `bg-success/10` | `var(--green-500)` / `var(--green-50)` |
| `text-error` / `bg-error/10`     | `var(--red-500)` / `var(--red-50)`     |

See [migration.md](migration.md) for the broader strategy.

---

## 9. Changelog

| Date       | Change                                       |
| ---------- | -------------------------------------------- |
| 2026-05-13 | Initial extraction from polished.html (v1.0) |
