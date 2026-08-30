# Spec 100 — Design System Phase 6: Zone View 2-Column Layout

> Phase 6 of the [094 UI redesign umbrella](../094-ui-redesign/spec.md). Reframed: the merge of Modes + Recettes under one panel **already exists in production** (HomePage.tsx line 199 wraps both inside a single `CollapsibleSection` titled "Comportements"). The remaining work is the **2-column desktop layout** from the polished mock.

## Problem

The zone view on desktop today stacks panels vertically inside a `max-w-[720px]` single column:

```
[Hero + strip + zone commands]
[Équipements] (CollapsibleSection)
[Comportements] (CollapsibleSection containing Modes + Recettes)
```

The polished mock prescribes a **2-column desktop layout** (`grid-template-columns: 1.5fr 1fr`):

```
[Hero + strip + zone commands]
┌─────────────────────────┬────────────────────┐
│ ÉQUIPEMENTS             │ COMPORTEMENTS      │
│ (heavier, 1.5fr)        │ (1fr)               │
│   THERMOSTAT (cat-head) │   MODES (cat-head) │
│   ÉNERGIE (cat-head)    │   RECETTES         │
│   MÉTÉO (cat-head)      │                    │
│   AUTRES (cat-head)     │ [Activity slot]    │
│                         │ (spec 101 future)  │
└─────────────────────────┴────────────────────┘
```

The single-column `max-w-[720px]` constrains horizontal real estate even on wide desktop monitors. The 2-column layout puts behaviors (modes + recipes) visually adjacent to the equipments they configure — a clearer mental model.

## Goal

Replace the single-column wrapper in [HomePage.tsx](../../ui/src/pages/HomePage.tsx) with a responsive grid:

- **Desktop (≥ 1024 px)**: `grid-cols-[1.5fr_1fr]` with gap. Équipements left, Comportements right.
- **Mobile (< 1024 px)**: stack — Équipements then Comportements.
- Reserve right-column space for the future Activity feed (spec 101) — add a placeholder comment, no UI yet.

## Non-negotiable constraints

> **Mobile layout is fragile — protect it.** The current mobile experience (single column, full width, CollapsibleSection collapsed/expanded toggle) must remain identical. The 2-col rule applies only at `lg:` breakpoint and above.

> **No section content changes.** Équipements, Modes, Recettes render their data exactly as before. The CollapsibleSection wrapper is preserved (chevron expand/collapse, storageKey-based persistence). Only the parent wrapper changes.

## In scope

1. Replace `<div className="max-w-[720px] space-y-6">` with a responsive grid wrapper in HomePage.tsx.
2. Adjust the max-width container above (`max-w-[720px] mb-5` for hero/strip/zcmds) to a wider max so the 2-col layout has space — likely `max-w-[1200px]` or no max-width.
3. Mobile stays single-column via Tailwind's responsive prefix.
4. Add a clearly-marked placeholder comment in the right column for spec 101 ActivityPanel.

## Out of scope

- The Modes + Recettes merge (already done in production).
- New ActivityPanel component (spec 101).
- Per-section layout changes (rows, cat-heads, panels) — those are individual sub-specs.
- Hero / strip / zcmds redesign — already covered by 094, 095, 097.
- The CollapsibleSection chevron / persistence behavior.
- Admin pages, dashboard, energy pages.
- **`panel__sub` "dans cette zone" subtitle from the mock — explicitly NOT adopted.** The user finds it redundant ("we're obviously in a zone, the title is enough"). Production stays with just the section title.

## Acceptance criteria

- [x] Desktop ≥ 1024 px: Équipements left (1.5fr), Comportements right (1fr), visible side-by-side (Playwright validated on Séjour 1440px)
- [x] Mobile < 1024 px: single column, Équipements first then Comportements (Playwright validated on Séjour 390px)
- [x] Gap between columns visible on desktop (24 px via `gap-6`)
- [x] Hero + strip + zone commands max-width bumped to 1200px
- [x] CollapsibleSection chevron + state persistence work unchanged (no change to component)
- [x] No layout regression on mobile — bottom tab bar preserved
- [x] Long equipment lists don't overflow — natural column flow
- [x] Type-check, lint, vitest, build all pass (429 tests)

## Edge cases

| Case                                                   | Expected                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Zone with many equipments (e.g. Séjour with 10+ items) | Left column scrolls naturally; right column not stretched               |
| Zone with no equipments and no modes/recipes           | Both sections show their empty state; layout intact                     |
| Tablet 768 px (intermediate viewport)                  | Stays single column (Tailwind `lg:` triggers at 1024 px)                |
| Resize from mobile to desktop while on a zone          | Layout switches; CollapsibleSection state preserved                     |
| Section collapsed on mobile, then switch to desktop    | Section stays collapsed (storage key not impacted)                      |
| Future ActivityPanel insertion (spec 101)              | Right column has a slot; placeholder comment shows where to add         |
| Sidebar collapsed (sidebar 68px wide)                  | More room for the 2-col layout — no specific change needed, grid adapts |
| Mobile burger menu open                                | Doesn't affect the zone layout                                          |
| Dark mode                                              | Grid wrapper has no specific theme dependency                           |

## References

- [design-system/components/panel.md](../../design-system/components/panel.md)
- [design-system/migration.md](../../design-system/migration.md) Phase 6
- [ui-redesign-B-polished.html](../094-ui-redesign/mockups/ui-redesign-B-polished.html) lines 557-558 (CSS), 2588-2932 (HTML) — visual reference
- [ui/src/pages/HomePage.tsx](../../ui/src/pages/HomePage.tsx) lines 176-205 — current layout
