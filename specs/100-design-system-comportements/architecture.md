# Architecture — Spec 100 — Zone View 2-Column Layout

## Overview

One file modified: `ui/src/pages/HomePage.tsx`. No backend, no state, no component creation.

## Current layout

```tsx
// HomePage.tsx — current (line 176)
<div className="max-w-[720px] space-y-6">
  <CollapsibleSection title={t("equipments.title")} ...>
    <ZoneEquipmentsView ... />
  </CollapsibleSection>
  {(modes || recipes) && (
    <CollapsibleSection title={t("behaviors.title")} storageKey="section-behaviors">
      <div className="space-y-3">
        <ZoneModesSection zoneId={zoneId} />
        <ZoneRecipesSection zoneId={zoneId} zoneName={currentZone.name} />
      </div>
    </CollapsibleSection>
  )}
</div>
```

Single column, max 720 px wide. Stacked vertically.

## Target layout

```tsx
// HomePage.tsx — proposed
<div className="max-w-[1200px] grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] lg:gap-6 gap-6">
  {/* Left column — Équipements */}
  <CollapsibleSection title={t("equipments.title")} ...>
    <ZoneEquipmentsView ... />
  </CollapsibleSection>

  {/* Right column — Comportements + future Activity */}
  <div className="space-y-6">
    {(modes || recipes) && (
      <CollapsibleSection title={t("behaviors.title")} storageKey="section-behaviors">
        <div className="space-y-3">
          <ZoneModesSection zoneId={zoneId} />
          <ZoneRecipesSection zoneId={zoneId} zoneName={currentZone.name} />
        </div>
      </CollapsibleSection>
    )}
    {/* TODO spec 101: ActivityPanel slot */}
  </div>
</div>
```

Key changes:

1. `max-w-[720px]` → `max-w-[1200px]` (room for 2 columns)
2. `space-y-6` → `grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] lg:gap-6 gap-6`
3. Right column wrapped in a `<div className="space-y-6">` to host both Comportements (now) and ActivityPanel (spec 101)

## Mobile behavior

- `< 1024 px`: `grid-cols-1` — single column, stack order in JSX = visual order (Équipements, then Comportements)
- `≥ 1024 px` (`lg:` prefix): `grid-cols-[1.5fr_1fr]` activates, side-by-side

Tailwind's `lg:` breakpoint is 1024 px by default. Below that (including all tablets), the layout stays single-column — exactly what we want.

## Hero + strip + zone commands above

The block above the grid currently uses `max-w-[720px]`:

```tsx
<div className="max-w-[720px] mb-5">
  {/* Zone title H1 */}
  {/* ZoneAggregationPills */}
  {/* ZoneCommands */}
</div>
```

We need to align this block with the new grid below. Two options:

**Option A** — make this block as wide as the new grid (`max-w-[1200px]`). Aligned but the hero feels stretched.
**Option B** — keep the hero at `max-w-[720px]` and let the grid extend wider below. Discontinuity in left-alignment.

The polished mock shows the hero spanning the same width as the grid (Option A). I'll go with that.

## File changes

| File                        | Change                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `ui/src/pages/HomePage.tsx` | Replace single-column wrapper with responsive grid; bump hero block max-width to align |

## Risk assessment

| Risk | Likelihood | Mitigation |
| -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ----------------------------------------------------------------------------------------------------------- |
| Right column too narrow at intermediate desktop sizes (1024-1200 px) | Medium | 1.5fr/1fr gives the right column ~40% of available width. At 1024 px viewport - sidebar 260 px - padding 32 px = ~730 px content. 40% = ~290 px — tight but workable for Modes + Recettes. Test. |
| Long zone names overflow hero block when wider | Low | H1 has `truncate` already (verified) |
| Tablet 768 px viewport shows awkward in-between state | Verified | Tailwind `lg:` only activates ≥ 1024 px. Tablets stay single column. |
| CollapsibleSection state persistence broken | Very low | The component is untouched; its storageKey-based useState persists per section regardless of parent. |
| Right column empty when zone has no modes/recipes | Low | `(modes                                                                                                                                                                                          |     | recipes) && (...)` already gates rendering. If false, right column is empty placeholder ready for spec 101. |
| Mobile order regression | Low | JSX order = render order in a stack grid. Équipements appears first, Comportements second. Matches user choice. |

## Rollback

`git revert` of the commit. Single file modified.

## References

- [ui/src/pages/HomePage.tsx](../../ui/src/pages/HomePage.tsx) — current layout
- [ui-redesign-B-polished.html](../094-ui-redesign/mockups/ui-redesign-B-polished.html) — visual reference
- [Tailwind responsive design](https://tailwindcss.com/docs/responsive-design) — breakpoint reference
