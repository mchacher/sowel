# Migration plan

> How to migrate the current production codebase (`ui/src/**`) from ad-hoc Tailwind classes toward the tokens-driven system documented here.

---

## 1. Current state of the production code

The Sowel UI is React + **Tailwind v4** with a CSS-based `@theme` block in [ui/src/index.css](../ui/src/index.css). Tokens are already CSS variables (`--color-primary`, `--color-surface`, etc.), and theme switching is already wired in [ui/src/theme.ts](../ui/src/theme.ts):

- Setting: `light` | `dark` | `system` stored in `localStorage.sowel_theme`
- Activation: `.dark` class toggled on `<html>` (with `system` listening to `prefers-color-scheme`)
- UI: a selector in Settings already lets the user choose

What's missing:

- A documented token registry (tokens.md does this now).
- Component-level CSS classes with BEM scoping (polished.html introduces these).
- Per-component spec with anatomy, states, accessibility (the `components/` folder does this).
- The **refined palette** — current Warm light + dark are functional but pre-design-system.

**Key insight**: because the theme infrastructure is already token-driven, the migration is essentially (a) swapping the _values_ the existing tokens resolve to, and (b) adopting BEM component classes incrementally.

---

## 2. Strategy: in-place palette swap

We **replace the current palette** with the design system palette inside the existing `@theme` block. No new "Hybrid" option, no opt-in toggle, no parallel palettes. The existing `light | dark | system` selector keeps working — it just routes to the new, refined palette.

Why in-place (vs. cohabitation):

- A 4th theme option would expose half-finished work to all users.
- The new palette has been validated visually in `specs/094-ui-redesign/mockups/ui-redesign-B-polished.html` against every component.
- Rollback is a single git revert of one CSS file — granular per-user rollback isn't worth the maintenance debt of running two palettes.
- If we _do_ need a kill switch during rollout, we wrap the `@theme` rewrite in a backend feature flag served at app bootstrap.

---

## 3. Phases

### Phase 0 — Palette swap (1 PR)

Import `design-system/tokens.css` at the top of [ui/src/index.css](../ui/src/index.css), then rewrite the `@theme` block to alias to the design system tokens:

```css
@import "tailwindcss";
@import "../../design-system/tokens.css";

@theme {
  --color-primary: var(--p-500);
  --color-primary-light: var(--p-50);
  --color-primary-hover: var(--p-600);
  --color-accent: var(--a-500);
  --color-accent-light: var(--a-50);
  --color-accent-hover: var(--a-600);
  --color-surface: var(--n-0);
  --color-background: var(--n-50);
  --color-text: var(--n-700);
  --color-text-secondary: var(--n-600);
  --color-text-tertiary: var(--n-400);
  --color-border: var(--line-2);
  --color-border-light: var(--line);
  --color-success: var(--green-500);
  --color-warning: var(--a-500);
  --color-error: var(--red-500);
  /* etc. — full mapping in §5 below */
}
```

Bridge the dark mode mechanism: `tokens.css` uses `[data-theme="dark"]`; the production app uses `.dark` class. Update the selector in `tokens.css` to `[data-theme="dark"], .dark` so both work without touching [ui/src/theme.ts](../ui/src/theme.ts).

**Expected outcome**: visible palette refinement on every page. Before/after screenshots on Dashboard + Zone view + Énergie are the acceptance gate. Functional diff = zero.

**Rollback**: `git revert` of the index.css + tokens.css selector tweak.

### Phase 1 — Typography & tabular nums (1 PR, mostly invisible)

- Add the tabular-nums + Inter feature settings selectors from `tokens.css` to the global stylesheet.
- Sweep `text-[13px]`, `text-[12px]` etc. into a small set of consistent classes.
- Verify on energy values, temperatures, timestamps, activity feed.

### Phase 2 — Sidebar nav (1 PR, ~1 day)

Refactor `ui/src/components/layout/Sidebar.tsx` to adopt `.sb__item` / `.sb__item--active`. Add separator rules around Modes / Analyse / Énergie. Replace the Modes icon (`ToggleRight` → `Layers`).

**Risk**: low, UI-only, immediately visible.

### Phase 3 — Strip pills (`ZoneAggregationPills`)

[ui/src/components/zones/ZoneAggregationPills.tsx](../ui/src/components/zones/ZoneAggregationPills.tsx):

- Drop per-pill background tint (verify whether already absent).
- Group rendered pills into semantic clusters (lights | openings | climate) with `--line-2` dividers.
- Add the `--alert` pill variant with red background + pulsing leading dot.
- Mobile: keep horizontal scroll, verify dividers render.

### Phase 4 — Dashboard alignment

The SVG icon work is already done in the mock (`WidgetIcons.tsx` is production-aligned). Remaining:

- Snap widget radius from `10px` → `--r-md` (8 px).
- Verify `.widget`, `.widget__title`, `.widget__art`, `.widget__big`, `.widget__footer` grid matches the spec.
- Verify the energy-meter widget uses tabular-nums consistently.

**Risk**: low, isomorphic.

### Phase 5 — Equipment row (`eq` pattern)

The biggest chunk. Refactor **one equipment type per PR**, not file-by-file:

1. `LightControl.tsx` → `.eq__icon--light-on` + glow animation
2. `ShutterControl.tsx` → `.shutter-grp` (3-button segmented)
3. `HeaterControl.tsx` → therm-icon + ± target
4. `GateControl.tsx` → `.gate-cmd` button
5. … remaining 17 equipment types (sensors, energy_meter, weather forecast, etc.)

Each PR adds a visual regression test on a fixture zone. Roll forward.

### Phase 6 — Comportements panel (modes + recipes)

Merge `ZoneModesSection.tsx` and `ZoneRecipesSection.tsx` under a single `ZoneBehaviorsPanel` with two `cat-head` sub-sections (Modes + Recettes). Visual diff: significant. Functional diff: zero.

### Phase 7 — Activity feed (additive)

New `ActivityPanel` component, fed by the existing WebSocket events stream. Lives in a second column on desktop, bottom scroll area on mobile. No refactor — pure addition.

### Phase 8 — Recipe edit modal

Replace the inline expand in `ZoneRecipesSection.tsx` with a modal mounted at app root. Includes the new "Surcharges par mode" section, which requires backend support (mode override CRUD).

**Only phase with backend impact** — write a spec first.

---

## 4. Recommended shipping order

Ship 0 → 2 → 3 → 4 first (fast visible wins, low risk). Then 1 (invisible polish) in parallel. Phase 5 is the long pole (2-3 weeks of typed-equipment PRs). Phases 6-8 follow once the row pattern is fully consolidated.

---

## 5. Class name migration table

| Tailwind utility                                                                                       | New BEM class               | Notes                               |
| ------------------------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------- |
| `bg-surface rounded-[12px] border border-border-light`                                                 | `panel`                     | Top-level container                 |
| `flex items-center px-4 py-2.5 bg-primary/8`                                                           | `panel__head`               | Panel header with primary-tinted bg |
| `text-[12px] font-semibold uppercase tracking-wider text-primary`                                      | `panel__title`              |                                     |
| `flex items-center px-4 py-2 bg-bg/50 text-[11px] uppercase`                                           | `cat-head`                  | Sub-category header                 |
| `grid grid-cols-[32px_1fr_auto_auto_auto] gap-3 px-4 py-2.5 border-t border-border-light min-h-[52px]` | `eq`                        | Equipment row grid                  |
| `w-8 h-8 rounded-[6px] flex items-center justify-center bg-accent/10 text-accent`                      | `eq__icon eq__icon--{type}` | Equipment icon — modifier by type   |
| `w-32 h-1.5 rounded-full bg-border-light`                                                              | `eq__slider`                | Slider track                        |
| `w-[26px] h-[26px] rounded-[6px] bg-bg/40 hover:bg-border-light`                                       | `power-btn`                 | Power button                        |
| `flex items-center px-3 py-1.5 hover:bg-border-light rounded-md`                                       | `sb__item`                  | Sidebar nav item                    |

**Migration approach per file**: don't refactor a whole file. Replace one component class at a time, test, commit. Roll forward.

---

## 6. What NOT to migrate

These conventions stay as-is — they predate the system and work fine:

- The **toast / notification system** (production has its own). Not in scope.
- **Form input components** beyond the modal (`Settings`, `EquipmentForm`, `RecipeForm` in admin). Future scope.
- **Dashboard widget system**. Future scope.
- **Energy charts** (`EnergyBarChart.tsx`, etc.). Future scope, separate spec.

These will adopt tokens incrementally as `tokens.css` is in scope (since they use Tailwind too), but their full re-spec is not part of this initial migration.

---

## 7. Rollback path

- **Phase 0** (palette swap): single `git revert` of `index.css` + `tokens.css` selector tweak. Restores the previous palette in seconds.
- **Phases 2-8** (component refactors): each PR is independently revertible because BEM classes live alongside Tailwind utilities — old JSX keeps working until explicitly migrated.
- **Optional kill switch**: if the rollout reveals a regression in production but Phase 0 has shipped, the `@theme` block can be conditionally swapped at runtime via a backend-served feature flag. Avoid building this unless an incident actually requires it.

---

## 8. Acceptance criteria

The migration is considered complete when:

- ✅ `tokens.css` is the source of truth for all design values (Phase 0)
- ✅ Every component in [components.md](components.md) has a React implementation
- ✅ Each `components/*.md` spec has matching React props
- ✅ Accessibility audit passes for the zone view + dashboard + energy pages
- ✅ Polished.html is no longer needed as a reference — production renders identically

---

## 9. See also

- [README.md](README.md) — System philosophy and structure
- [tokens.md](tokens.md) — Tokens reference
- [components.md](components.md) — Component inventory
