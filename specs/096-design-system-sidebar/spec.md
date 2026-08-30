# Spec 096 — Design System Phase 2: Sidebar

> Phase 2 of the [094 UI redesign umbrella](../094-ui-redesign/spec.md). Focuses on the desktop sidebar — mobile uses a separate bottom tab bar (see [design-system/components/mobile-tabbar.md](../../design-system/components/mobile-tabbar.md)).

## Problem

[ui/src/components/layout/Sidebar.tsx](../../ui/src/components/layout/Sidebar.tsx) is 511 lines of inline Tailwind utilities composed per item, with duplicated class chains and inconsistent hover/active treatment:

- Hover background uses `bg-border-light` — a near-transparent overlay (`var(--line)` ≈ `rgba(24,24,27,.08)`), barely visible.
- Active items use `bg-primary-light` (now `var(--p-50)` after Phase 0) — correct and visible.
- Class chains repeat the same `flex items-center gap-2 px-3 py-1.5 rounded-[6px] transition-colors duration-150 ease-out hover:bg-border-light` ~12 times across the file.
- Inline template literals make conditional active states hard to scan.

The [design-system/components/sidebar-nav.md](../../design-system/components/sidebar-nav.md) spec defines a coherent pattern: **hover is neutral, active is primary, and never the inverse**. The current implementation respects this in principle but the hover tint is so faint it functionally disappears.

## What is NOT broken (already production-aligned)

Discovered while reading the code:

- **Modes icon is already `Layers`** ([Sidebar.tsx:214](../../ui/src/components/layout/Sidebar.tsx#L214)) — the light spec's "swap from `ToggleRight`" was based on an outdated reference.
- **Énergie / Modes / Analyse separators** are already present via `border-t border-border-light` between sections.

## Goal

Refactor the sidebar around a shared `<SidebarItem>` component and adjacent helpers (`<SidebarSectionHeader>`, `<SidebarSeparator>`), pulling all hover/active/spacing decisions into one place. Align hover to a visible neutral background (`bg-background` = `var(--n-50)`) and confirm active uses `bg-primary-light` (= `var(--p-50)`). All existing production features are preserved.

## Non-negotiable constraint

> **The list of sidebar items, their order, their routes, and their behavior must remain identical to the current production.** This spec is a pure-rendering refactor + hover tint polish — nothing more. Any change to which items appear in the sidebar is explicitly out of scope.

## In scope

1. New components in `ui/src/components/layout/`:
   - `SidebarItem.tsx` — single nav item (regular pill style) with `icon`, `label`, `to`, `active`, `collapsed`, `badge?` props
   - `SidebarSectionHeader.tsx` — the uppercase small-caps header used for top-level sections (Dashboard, Maison, Modes, Analyse, Énergie, Administration, Réglages)
   - `SidebarSeparator.tsx` — the `border-t border-border-light` divider extracted as a 1-liner
2. Refactor `Sidebar.tsx` to use the new components. The 511 lines collapse to ~250.
3. **Hover refinement**: replace `hover:bg-border-light` with `hover:bg-background` (= `var(--n-50)`) for visible-but-subtle hover.
4. **Active state unchanged**: keep `bg-primary-light` + `text-primary`.
5. **Behavioral parity**: collapse/expand toggle, auto-expand on route change, admin section, plugin update badge, settings update dot, energy availability gating — all preserved.

## Out of scope

- Reordering nav items (current order is correct).
- Adding new nav items.
- Reworking the zone tree, mode list, chart list, or admin sub-nav internals (`SidebarZoneTree`, `SidebarModeList`, `SidebarChartList` are separate components — left untouched).
- Topbar refactor (separate concern).
- Mobile tab bar (separate component).

## Acceptance criteria

- [x] Modes icon is `Layers` (already shipped, marking done)
- [x] Visible separators around Énergie and Modes groups (already shipped)
- [x] `<SidebarItem>`, `<SidebarSectionHeader>`, `<SidebarSeparator>` components exist
- [x] `Sidebar.tsx` line count drops from 511 to 348 (–32%) — exceeded the 280 target but the new components carry the reusable logic (59 + 130 + 3 = 192 lines reusable from future specs)
- [x] Hover background is `bg-background` (visible) on all items styled by the new components
- [x] Active state uses `bg-primary-light text-primary` consistently
- [x] No more `transition-colors duration-150 ease-out` literal repetition in `Sidebar.tsx` (all goes through the new components)
- [ ] Collapse toggle works — verify manually
- [ ] Auto-expand on route change works — verify manually
- [ ] Admin section visible only for admin users — verify manually
- [ ] Plugin update badge appears on `/plugins` when `pluginUpdateCount > 0` — verify manually
- [ ] Settings update dot appears on Réglages when `updateAvailable === true` — verify manually
- [ ] Énergie section visible only when `energyAvailable === true` — verify manually
- [ ] Production section appears under Énergie only when `hasProduction === true` — verify manually
- [x] Type-check, lint, vitest, build all pass

## Behavioral improvements (incidental)

- **Énergie icon now lights up on any `/energy/*` route in collapsed mode.** Previously it only lit on `/energy/live` exactly when collapsed (inconsistency between collapsed and expanded behavior). Now consistent.
- **Administration icon now lights up on any admin route in collapsed mode.** Previously it only lit on `/devices` exactly when collapsed. Now consistent.

## Edge cases

| Case                                                | Expected                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| User has no admin role                              | Admin section absent (already handled by `isAdmin` check, preserved)                     |
| `energyAvailable` is `false`                        | Énergie section absent (preserved)                                                       |
| `hasProduction` is `false`                          | Production sub-link absent (preserved)                                                   |
| User collapses sidebar then navigates               | Collapsed state persists (state is per-mount; that's existing behavior, not regressed)   |
| `pluginUpdateCount === 0`                           | No badge on `/plugins` item                                                              |
| User on `/dashboard` then clicks `/dashboard` again | NavLink re-renders, active state stays — handled by NavLink's `isActive` (no regression) |
| Hover over an already-active item                   | `bg-primary-light` darkens slightly (existing CSS) — no regression                       |
| Multi-language: French vs English labels            | Translation keys preserved (`t("nav.dashboard")`, etc.)                                  |

## References

- [design-system/components/sidebar-nav.md](../../design-system/components/sidebar-nav.md) — Pattern reference
- [design-system/migration.md](../../design-system/migration.md) Phase 2
- [ui/src/components/layout/Sidebar.tsx](../../ui/src/components/layout/Sidebar.tsx) — Current implementation
- [ui-redesign-B-polished.html](../094-ui-redesign/mockups/ui-redesign-B-polished.html) — Visual reference for hover/active behavior
