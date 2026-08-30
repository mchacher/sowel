# Spec 097 — Design System Phase 3: Strip Pills (Zone Aggregation)

> Phase 3 of the [094 UI redesign umbrella](../094-ui-redesign/spec.md). Targets [ZoneAggregationPills.tsx](../../ui/src/components/home/ZoneAggregationPills.tsx), the strip of aggregated state at the top of every zone view.

## Problem

The current strip renders all pills as a flat list with uniform dividers between every item. Visually all data types compete for attention:

- A temperature reading (passive measurement) looks the same as a "fenêtre ouverte" warning.
- The smoke / water-leak alerts use `bg-error/8` — a barely-visible 8 % red overlay that doesn't register as urgent.
- The "motion: Calme" pill uses `text-text-tertiary` (greyed out) — informationally correct but visually identical to "no data" emptiness.
- The lights-on pill uses `text-active-text` (amber dark), but the icon stays in `text-text-tertiary` — inconsistent.

The [design-system strip spec](../../design-system/components/strip.md) splits pills into three semantic clusters and introduces variants (`--active`, `--calm`, `--alert`) that signal urgency / nature of the data.

## Goal

Refactor `ZoneAggregationPills.tsx` to:

1. Group pills into 3 visual clusters with a heavier inter-cluster divider:
   - **Sensors** (passive measurement): temperature, humidity, luminosity
   - **Counters / states** (active devices): motion, lights, shutters, water valves
   - **Alerts** (anomalies): open doors, open windows, water leak, smoke
2. Apply the design-system pill variants:
   - `--active` (amber icon + value) when at least one light is on
   - `--calm` (green icon + value) when the motion sensor is at rest
   - `--alert` (red bg + red text, **no pulse**) on smoke and water leak only
3. Keep open doors / windows on amber text (production behavior — no upgrade to red).
4. Preserve sparkline rendering on sensor pills.
5. Preserve mobile horizontal scroll behavior.

## Non-negotiable constraint

> **All existing aggregation logic must remain unchanged.** This spec touches only how the pills look, not when or what they render. The conditional rendering (a pill appears only if its data exists) is preserved verbatim.

## In scope

1. Refactor `ui/src/components/home/ZoneAggregationPills.tsx`:
   - Build the items array grouped by cluster
   - Render with intra-cluster dividers (current `--n-200`) and inter-cluster dividers (new `--line-2` heavier)
   - Apply variant classes per pill
2. Extract a small internal `<StripPill>` component (~30 lines) that owns the variant → Tailwind class mapping. Improves readability without spreading state across components.
3. **No pulse animation.** Smoke + leak get red bg + red text, but no animated dot. (User decision — pulsing on every leak/smoke event would be too aggressive.)
4. **No new icons.** Reuse the existing Lucide imports.

## Out of scope

- Reordering pills within a cluster (current order kept).
- Adding new aggregation types (no schema change).
- Changing pill content / labels / number formatting.
- Doors / windows upgrade to red alert (user choice — keep amber).
- Sparkline component changes.
- Mobile-specific styles (the existing `overflow-x-auto` already covers it).

## Acceptance criteria

- [x] Three visual clusters with `bg-border` (= `var(--line-2)`) heavier divider between them
- [x] Intra-cluster pills use `bg-border-light` thinner divider
- [x] Smoke and leak pills render with `bg-error/10` + `text-error` (no pulse)
- [x] Motion-at-rest pill ("Calme") uses green text + green icon (`text-success`)
- [x] Lights-on pill uses amber text + amber icon (`text-active-text`)
- [x] Open doors / windows keep their current amber styling (`text-active-text`)
- [x] All sparklines still render on sensor pills (temperature, humidity, luminosity)
- [x] Empty clusters collapse (no leading divider if the first cluster is empty)
- [x] Type-check, lint, vitest, build all pass (429 tests)
- [ ] Mobile horizontal scroll works (test viewport < 640 px) — verify on running app
- [ ] Visual verification on dev server (light + dark, with and without alerts)

## Edge cases

| Case                                            | Expected                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Zone with only sensors (no equipments yet)      | One cluster, no group dividers (only intra-cluster thin dividers)              |
| Zone with no sensors, only lights               | Counters cluster only — same as above, no group dividers                       |
| Zone with smoke alert but no other data         | Alerts cluster only                                                            |
| Zone with sensors + lights + smoke              | Three clusters, two group dividers                                             |
| Zone with motion sensor that never reported     | No motion pill (existing condition: `data.motionSensors > 0`)                  |
| Zone with motion "Calme" and `motionSince` null | Pill renders green without duration suffix                                     |
| Zone with `lightsTotal === 0`                   | No lights pill                                                                 |
| Zone with all data null                         | Component returns `null` (existing behavior)                                   |
| Resize from desktop to mobile                   | Strip scrolls horizontally; cluster dividers remain visible at their positions |
| Dark mode toggle                                | All variants adapt via design system tokens (no hard-coded hex)                |

## References

- [design-system/components/strip.md](../../design-system/components/strip.md)
- [design-system/components/pill.md](../../design-system/components/pill.md)
- [design-system/migration.md](../../design-system/migration.md) Phase 3
- [ui/src/components/home/ZoneAggregationPills.tsx](../../ui/src/components/home/ZoneAggregationPills.tsx) — current implementation
- [ui-redesign-B-polished.html](../094-ui-redesign/mockups/ui-redesign-B-polished.html) lines 2521-2565 — visual reference
