# Spec 094 — UI Redesign (umbrella + Phase 0 palette swap)

## Problem

The Sowel UI has grown organically over 90+ specs. Today it works — but visually it carries technical debt: arbitrary `text-[13px]` / `rounded-[6px]` values, inconsistent spacing across panels, two palettes (warm + dark) that pre-date the design language we've since refined, and no formal component layer. Every new feature reinvents button styles, panel headers, and row layouts.

A full design system has been authored in [design-system/](../../design-system/) (tokens, components, motion, accessibility) and validated against a reference HTML mock at [ui-redesign-B-polished.html](mockups/ui-redesign-B-polished.html). The remaining work is to migrate the production codebase to that system without breaking anything.

## Goal

Migrate `ui/src/**` to the design system documented in [design-system/](../../design-system/), incrementally, in 9 reversible phases. Phase 0 (palette swap) is delivered in **this** spec; phases 1-8 each get their own light spec (095-102) and are picked up via `/sowel-feature` when scheduled.

## Strategy

**In-place palette swap, no opt-in toggle.** The existing `light | dark | system` selector in [ui/src/theme.ts](../../ui/src/theme.ts) keeps working — it just routes to the refined palette. Rationale and rejected alternatives are documented in [design-system/migration.md](../../design-system/migration.md) §2.

## Phase breakdown

| #   | Spec                                                                          | Scope                                                        | Status      |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------- |
| 0   | **094 (this spec)**                                                           | Palette swap: rewrite `@theme` block to alias `tokens.css`   | in-progress |
| 1   | [095-design-system-typography](../095-design-system-typography/spec.md)       | Tabular nums, Inter feature settings, type scale consistency | planned     |
| 2   | [096-design-system-sidebar](../096-design-system-sidebar/spec.md)             | Adopt `.sb__*` BEM, Layers icon for Modes, separator rules   | planned     |
| 3   | [097-design-system-strip-pills](../097-design-system-strip-pills/spec.md)     | Cluster pills (lights / openings / climate), alert variant   | planned     |
| 4   | [098-design-system-dashboard](../098-design-system-dashboard/spec.md)         | Widget radius alignment, BEM consolidation                   | planned     |
| 5   | [099-design-system-equipment-row](../099-design-system-equipment-row/spec.md) | `.eq` grid + per-type icons, one PR per equipment type       | planned     |
| 6   | [100-design-system-comportements](../100-design-system-comportements/spec.md) | Merge Modes + Recipes into one Comportements panel           | planned     |
| 7   | [101-design-system-activity-feed](../101-design-system-activity-feed/spec.md) | New `ActivityPanel` fed by WebSocket events                  | planned     |
| 8   | [102-design-system-recipe-modal](../102-design-system-recipe-modal/spec.md)   | Modal + "Surcharges par mode" (only phase with backend work) | planned     |

Recommended shipping order: **0 → 2 → 3 → 4** first (visible wins, low risk), then **1** in parallel, then **5** (long pole), then **6 → 7 → 8**.

## In scope (this spec)

1. Import `design-system/tokens.css` into [ui/src/index.css](../../ui/src/index.css).
2. Rewrite the existing `@theme` block to alias each `--color-*` to a design system token (`--p-*`, `--n-*`, `--a-*`, `--green-*`, `--red-*`, etc.).
3. Bridge dark-mode mechanism: `tokens.css` uses `[data-theme="dark"]`, the prod app uses `.dark` class. Extend the selector in `tokens.css` to support both (`[data-theme="dark"], .dark`).
4. Visual acceptance: screenshot every top-level page (Dashboard, Zone view, Énergie, Modes, Settings, Login) in both light + dark + system modes, before/after. Diff is **expected** — it is the palette refinement.
5. No JSX changes. BEM component classes are introduced in subsequent phases.

## Out of scope (this spec)

- Any change to JSX or React components.
- BEM class adoption (deferred to phases 2-8).
- Activity feed and Recipe modal (specs 101, 102).
- Backend changes (none required for the umbrella or Phase 0).
- Documentation rewrites — `design-system/` is already the source of truth.

## Acceptance criteria (this spec)

- [x] `tokens.css` is imported at the top of `ui/src/index.css`
- [x] The `@theme` block aliases all `--color-*` tokens to design system equivalents
- [x] `tokens.css` dark-mode selector accepts both `[data-theme="dark"]` and `.dark`
- [x] `npm run build` succeeds in `ui/`
- [x] `npx tsc --noEmit` passes in both backend and UI
- [x] Backend test suite green (`npx vitest run` — 429 tests passed)
- [x] Backend ESLint green
- [ ] No console errors on app start (verify on running app before merge)
- [ ] Light, dark, and system theme modes all render correctly (verify on running app before merge)
- [ ] Side-by-side screenshots captured for Dashboard, Zone view, Énergie (before + after, light + dark)

## Acceptance criteria (full UI redesign — all phases)

- [ ] Every component in [design-system/components.md](../../design-system/components.md) has a React implementation matching its spec
- [ ] No more arbitrary Tailwind values (`text-[13px]`, `rounded-[6px]`) in `ui/src/**`
- [ ] Accessibility audit passes for Zone view + Dashboard + Énergie (contrast, focus, ARIA)
- [ ] Polished.html is no longer needed as a reference

## Edge cases

| Case                                                | Expected                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| User has `system` mode + OS in dark                 | The new dark palette applies. Switching OS to light flips to the new light palette. No flash on load. |
| User has stored `sowel_theme = "warm"` (deprecated) | `applyTheme()` already falls back to `system` for unknown values — no migration needed.               |
| New token referenced before import resolved         | Build fails. Caught by `npm run build` gate.                                                          |
| User loads an older bookmarked page hash            | Tokens are global — every page picks them up automatically.                                           |

## References

- [design-system/README.md](../../design-system/README.md) — System philosophy
- [design-system/tokens.css](../../design-system/tokens.css) — Source of truth for all CSS variables
- [design-system/migration.md](../../design-system/migration.md) — Full migration narrative
- [ui-redesign-B-polished.html](mockups/ui-redesign-B-polished.html) — Reference implementation mock
- [ui/src/theme.ts](../../ui/src/theme.ts) — Existing light/dark/system mechanism (unchanged)
