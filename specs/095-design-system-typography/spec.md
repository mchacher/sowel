# Spec 095 — Design System Phase 1: Typography Polish

> Phase 1 of the [094 UI redesign umbrella](../094-ui-redesign/spec.md). A real typography pass with 4 visible improvements, replacing the originally-narrow scope.

## Problem

The codebase has accumulated typographic inconsistencies that subtly undermine the refined visual the design system targets:

1. **Uppercase labels feel cramped.** Production uses `tracking-wider` (0.05em) on uppercase labels (sidebar section titles, panel headers, cat-heads). The design system targets `0.1em–0.14em` (visibly more "premium"). Today's labels look tighter than the polished mock.
2. **H1 titles aren't consistent across pages.** 17 H1 elements across pages use 5 different size patterns (17 / 18 / 20 / 22 / 24 px). Three pages (Logs, MQTT Publishers, Plugins) use non-responsive `text-[24px]` — too large on mobile.
3. **Some body text is below WCAG-safe 12 px on mobile.** Scattered `text-[10px]` / `text-[11px]` usage hurts readability for users with vision issues.
4. **Mono numeric containers don't all get tabular nums.** Some places use the `tabular-nums` utility; others don't. Developers must remember each time.

## Goal

Three concrete sweeps and one global rule, in one pass:

- **A.** Replace `uppercase tracking-wider` → `uppercase tracking-widest` (0.05em → 0.1em) on the 87 uppercase labels.
- **B.** Standardize all H1 page titles to `text-[18px] sm:text-[24px] font-semibold text-text leading-[24px] sm:leading-[32px]`.
- **C.** Selective audit + bump of `text-[10px]` / `text-[11px]` to `text-[12px]` where the text is **body content on mobile** (not badges / chips / meta where small is intentional).
- **D.** Add a global CSS rule: `.font-mono { font-feature-settings: "tnum" 1; }` — tabular nums become the default for monospace.

## Non-negotiable constraint

> **No layout changes.** Letter-spacing widens but doesn't break line wrapping (verified — see edge cases). Font sizes change in three specific places (Bundle B); everywhere else, only `tracking-*` swaps. Component logic is not touched.

## In scope

### Bundle A — letter-spacing (87 occurrences)

Replace exactly `uppercase tracking-wider` with `uppercase tracking-widest` across the codebase. The 4 occurrences of `tracking-wider` without `uppercase` (recipe slot labels in `ZoneRecipesSection.tsx`) are excluded — they're not uppercase, the design system rule doesn't apply.

### Bundle B — H1 standardization (17 places)

Canonical H1 class chain:

```
text-[18px] sm:text-[24px] font-semibold text-text leading-[24px] sm:leading-[32px]
```

Pages currently diverging:

- `LogsPage.tsx` — `text-[24px]` no responsive → add `sm:` prefix
- `PluginsPage.tsx` — `text-[20px] sm:text-[24px]` → unify to `text-[18px] sm:text-[24px]`
- `MqttPublishersPage.tsx` — same as Logs
- Any H1 at `text-[17px]` or `text-[22px]` — unify

Other H1s already matching the canonical chain stay unchanged.

### Bundle C — mobile readability

Targeted audit, not a blanket sweep. Bump `text-[10px]` / `text-[11px]` → `text-[12px]` ONLY when:

- The text is body content (not a chip badge, not a tag count, not a inline meta)
- The size is the default size for that element (not a responsive `sm:text-[...]` override)
- The text appears on mobile (not only desktop hover/tooltip)

Expected hit count: 5-15 places out of 289 occurrences. Document each in the PR.

### Bundle D — tabular nums baseline

Add to `ui/src/index.css`:

```css
.font-mono {
  font-feature-settings: "tnum" 1;
}
```

## Out of scope

- Sweep of arbitrary `text-[Npx]` sizes outside Bundle B (design system §2.2 allows inline arbitrary sizes).
- Font swap (Inter + JetBrains Mono stay).
- Heading hierarchy beyond H1 (H2/H3 audit deferred).
- Changes to `tracking-wider` occurrences NOT on uppercase labels (recipe labels keep the original tracking).
- Letter-spacing on titles / headings (per-component refactor as they come).

## Acceptance criteria

- [x] No `uppercase tracking-wider` remaining in `ui/src/**` (87 occurrences replaced by `uppercase tracking-widest`)
- [x] All 17 H1 page titles use the canonical class chain
- [ ] ~~No body-context `text-[10px]` / `text-[11px]` remaining outside chips/badges/meta~~ — **Bundle C deferred to dedicated audit spec** (too many cases for accurate single-PR judgment)
- [x] `.font-mono` global rule present in `ui/src/index.css`
- [x] Devtools confirms `font-feature-settings: "tnum" 1` on a `.font-mono` element (verified via Playwright)
- [x] Devtools confirms `font-feature-settings: "cv11" 1, "ss01" 1` on `<body>` (verified)
- [x] Manual: sidebar labels (DASHBOARD, MAISON, MODES, ANALYSE, ÉNERGIE) visibly more "spaced out" — screenshot validated
- [x] Manual: zone view panel heads (ÉQUIPEMENTS, COMPORTEMENTS) and cat-heads (THERMOSTAT, ÉNERGIE, etc.) widened — screenshot validated
- [x] Manual: mobile H1 on Logs page renders at 18px — screenshot validated
- [x] Manual: no text overflow / wrap regression from the wider letter-spacing — verified on 3 pages
- [x] Type-check, lint, vitest, build all pass (429 tests)

## Edge cases

| Case                                                          | Expected                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Sidebar label with wider tracking overflows in collapsed mode | Collapsed sidebar hides labels — irrelevant                                |
| Sidebar label overflows the 260 px sidebar width              | Labels are ≤ 12 chars + tracking-widest adds ~2 px width — visually fine   |
| Recipe slot label at `text-[10px] tracking-wider`             | Untouched (not uppercase, not in scope)                                    |
| H1 in admin sub-pages                                         | Use the canonical chain                                                    |
| Mobile chip-state showing "Calme · 39 min" at `text-[10px]`   | Unchanged — chip is intentional small (in scope C audit confirms not body) |
| Energy live value at `text-[28px]` mono                       | Tabular nums applies automatically via Bundle D                            |
| Dark mode                                                     | All rules respect existing theme tokens — no contrast regression           |

## References

- [design-system/tokens.md](../../design-system/tokens.md) §2.3 (text features) and §2.2 (type scale)
- [design-system/migration.md](../../design-system/migration.md) Phase 1
- [ui-redesign-B-polished.html](../094-ui-redesign/mockups/ui-redesign-B-polished.html) — visual reference for letter-spacing
