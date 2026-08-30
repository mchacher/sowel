# Sowel Design System

> Sober refinement for a home automation engine.

The Sowel design system codifies the visual language that emerged from the `specs/094-ui-redesign/mockups/ui-redesign-B-polished.html` iteration. It is opinionated, narrow, and shippable — it covers exactly what Sowel needs today, no more.

---

## 1. Philosophy

**Direction**: **sober refinement.** Not minimalism (we still surface state, alarms, and counts). Not maximalism (we never decorate to fill space). Every visual choice has a job to do.

**Three rules, in order**:

1. **The interface synthesizes, it does not inventory.** A zone view tells you _what is happening_ before it lists what could happen. Pills, badges, and aggregate counts are designed to be glanceable in under one second.
2. **One accent, one rhythm.** The amber `--a-500` is reserved for "a light is on right now" and nothing else. The orchestrated `rise` cascade on first paint is the only motion that touches multiple elements at once.
3. **Match the production pattern, then refine.** When the design diverges from `app.sowel.org`, the divergence is intentional and named in the relevant component spec.

These rules echo the [Anthropic frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design): _"choice is intentionality, not intensity."_ The system commits to refined minimalism, executes it precisely, and does not chase trends.

---

## 2. What's in this folder

| File                                 | Purpose                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| [tokens.md](tokens.md)               | Every design token (color, type, spacing, radius, shadow, motion) with naming convention, themes (Hybrid + Dark), and conversion notes |
| [tokens.css](tokens.css)             | Drop-in CSS file: copy into any new Sowel surface and the system is wired                                                              |
| [components.md](components.md)       | One-page inventory of every component pattern with anatomy, states, and accessibility notes                                            |
| [components/](components/)           | One Markdown file per component — full spec with HTML, CSS, mapping notes, do/don't examples                                           |
| [motion.md](motion.md)               | Animation primitives (rise stagger, glow, pulse), durations, and `prefers-reduced-motion` handling                                     |
| [accessibility.md](accessibility.md) | WCAG contrast measurements, touch-target rules, focus indicators, ARIA conventions                                                     |
| [migration.md](migration.md)         | How to migrate the current production codebase from ad-hoc Tailwind classes to the tokens-driven system                                |

The reference implementation lives in `specs/094-ui-redesign/mockups/ui-redesign-B-polished.html`. When in doubt about _how a component renders_, open that file and search for the BEM class.

---

## 3. Naming convention

The system uses **BEM** with a short prefix per scope:

```
.{scope}__{element}--{modifier}
```

| Prefix        | Scope                                                    |
| ------------- | -------------------------------------------------------- |
| `.sb__`       | Sidebar                                                  |
| `.topbar__`   | Topbar                                                   |
| `.hero__`     | Zone hero (title + lead)                                 |
| `.strip__`    | Sensor aggregation strip                                 |
| `.zcmds__`    | Zone command toolbar                                     |
| `.panel__`    | Generic panel (Équipements, Comportements, Activité)     |
| `.cat-head__` | Sub-category header inside a panel                       |
| `.eq__`       | Equipment row                                            |
| `.mode-row__` | Mode row                                                 |
| `.recipe__`   | Recipe row                                               |
| `.modal__`    | Modal dialog                                             |
| `.activity__` | Activity feed item                                       |
| `.mob__*`     | Mobile-specific variants (e.g. `.mob__eq`, `.mob__mode`) |

Rules:

- Modifier names describe _state_, not appearance (`--active`, `--alert`, `--calm` — not `--blue`, `--big`).
- Color tokens (`--p-50`, `--a-500`) are always referenced through CSS variables, never hard-coded.
- A component may not reach into another component's classes. If two surfaces share a chip, the chip is its own pattern (`.chip-state`).

---

## 4. Themes

Two themes are supported, both selected via `data-theme` on `<html>`:

- **Hybrid** (`data-theme="hybrid"`, default) — neutral zinc base with Sowel amber accent. Daytime-first.
- **Dark** (`data-theme="dark"`) — Linear-ish night. Same tokens, inverted neutrals, brighter primary/accent.

All component rules read tokens. **A component never branches on `data-theme`** unless absolutely necessary (e.g. dark-only override of an icon-on color contrast — see `eq__icon--light-on`). When such an override is unavoidable, the spec for that component documents it.

---

## 5. Phasing the implementation

If you are migrating the production codebase, follow [migration.md](migration.md). The short version:

1. **Drop in `tokens.css`** at the root of `ui/src/`. Replace direct color values with CSS vars in one branch, ship, verify nothing visually drifted.
2. **Adopt one component at a time** starting with `panel` and `cat-head` (they cascade visually).
3. **Replace per-component**: lift the existing JSX, swap classNames for the BEM ones, verify states against the spec.
4. **Cut over to Hybrid theme**, leave Warm as a deprecated rollback for one release.

The system is designed for incremental adoption: nothing forces a big-bang refactor.

---

## 6. Conventions for evolving the system

- **A new pattern is added only after it appears in two places.** A one-off goes inline.
- **Tokens are added only when no existing token fits.** Avoid color drift (no introducing a third shade of blue).
- **Every spec includes an "accessibility" section.** No exceptions.
- **Every change to a token requires a contrast check.** The accessibility doc has the table to update.

---

## 7. Open questions

These are deferred to a future revision:

- **Inter** is used as body font. The Anthropic frontend-design skill discourages it as generic. We accept it for legibility and production parity, but should periodically re-evaluate against pairs like Geist + Roboto Mono, or Söhne + JetBrains Mono.
- **No dedicated component for charts** — energy bar/line charts use the current production conventions. A future spec should formalize axis, gridlines, legend.
- **No formal token versioning** — when token semantics change, add a row in `tokens.md` change log and bump the file header date.
- **Illustration system** is partially documented (note in `components/dashboard-widget.md`) but the line-art SVGs used in Dashboard widgets are not yet formalized as their own spec. Proposed for v1.1 if the illustration set grows beyond the current dashboard scope.
- **Dashboard widget radius** is `10 px` in production (arbitrary). Design system targets `--r-md` 8 px. Tolerated divergence — to align in the next dashboard refactor.
