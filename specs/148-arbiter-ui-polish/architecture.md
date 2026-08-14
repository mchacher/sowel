# Spec 148 — Architecture (Phase A)

## New tokens — `design-system/tokens.css`

Add a shared **energy palette** with light + dark variants, aliased in
`ui/src/index.css` as `--color-*` (same pattern as the existing scale tokens).

```css
/* Energy palette (spec 148) — was hardcoded in EnergyBarChart/ProductionBarChart/
   LiveEnergyPage/ArbitrationSurface. Solar greens match the production graph. */
:root,
[data-theme="hybrid"] {
  --solar-injection: #2d8f3e; /* surplus / injection (dark green) */
  --solar-auto: #6bcb77; /* auto-consumption / "accordé"     */
  --solar-production: #4ca85c; /* solar production                 */
  --energy-hp: #4f7be8; /* consumption (peak, vivid blue)   */
  --energy-hc: #93b5f0; /* consumption (off-peak, light blue) */
  --energy-grid: #4a6396; /* grid import (slate blue)         */
  --slate-neutral: #6e7c88; /* On (hors pilotage), manual/off   */
}
[data-theme="dark"],
.dark {
  --solar-injection: #3da855;
  --solar-auto: #74c77f;
  --solar-production: #57be6c;
  --energy-hp: #6e93ee;
  --energy-hc: #5e7fc0;
  --energy-grid: #7e93c0;
  --slate-neutral: #8a97a3;
}
```

`ui/src/index.css` `@theme` block gains matching `--color-solar-injection`,
`--color-solar-auto`, `--color-solar-production`, `--color-energy-hp`,
`--color-energy-hc`, `--color-energy-grid`, `--color-slate` aliases so Tailwind
utilities (`bg-solar-auto`, `text-solar-injection`, …) and `var(--color-*)`
both resolve. (Exact dark values tuned during implementation for contrast.)

## Hex → token mapping

| File                               | Hex constant                                                                                                                      | New token                                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EnergyBarChart.tsx:37-39`         | `#4F7BE8` HP / `#93B5F0` HC / `#6BCB77` autoconso                                                                                 | `--color-energy-hp` / `--color-energy-hc` / `--color-solar-auto`                                                                                                                                             |
| `ProductionBarChart.tsx:31-33`     | `#2D8F3E` injection / `#4CA85C` production                                                                                        | `--color-solar-injection` / `--color-solar-production`                                                                                                                                                       |
| `LiveEnergyPage.tsx:29-32`         | `#4F7BE8` / `#4A6396` / `#9CA3AF` / `#6BCB77`                                                                                     | `--color-energy-hp` / `--color-energy-grid` / `--color-text-tertiary` / `--color-solar-auto`                                                                                                                 |
| `ArbitrationSurface.tsx:30-35,246` | `#33529E` household / `#6BCB77` granted / `#123f1c` granted-text / `#BB8232` HC / `#6E7C88` manual / `#E5484D` revoke / `#9CA3AF` | household→`--color-energy-hp` (blue), granted→`--color-solar-auto`, granted-text keep dark-green readable, manual/unclaimed→`--color-slate`, revoke→`--color-error`, surplus curve→`--color-solar-injection` |
| `ArbitrationSurface.tsx:326-338`   | `text-green-700 dark:...` / `text-amber-*`                                                                                        | `text-success`/`text-warning` semantic                                                                                                                                                                       |
| `ArbiterSettings.tsx:229`          | `text-red-500`                                                                                                                    | `text-error`                                                                                                                                                                                                 |

Inline `style={{ backgroundColor: HEX }}` sites switch to
`style={{ backgroundColor: "var(--color-…)" }}`; SVG `fill=`/`stroke=` likewise.

## "On (hors pilotage)" merge

In `ArbitrationSurface`, the timeline/segment kinds `manual` (override) and
`unclaimed-run` currently render with different colours. Map **both** to the
single `--color-slate` solid fill and one legend entry "On (hors pilotage)". A
small pure helper centralises the mapping and is unit-tested:

```ts
// ui/src/components/energy/arbiterColors.ts
export function arbiterStateColor(kind: ArbiterSegmentKind): string {
  switch (kind) {
    case "granted":
      return "var(--color-solar-auto)";
    case "revoked":
      return "var(--color-error)";
    case "manual":
    case "unclaimed":
      return "var(--color-slate)"; // On (hors pilotage)
    default:
      return "var(--color-n-100)";
  }
}
```

The **journal** row text is unchanged (keeps "pilotage manuel" / "marche hors
arbitrage") so the precise cause survives.

## Emoji → Lucide

`ArbitrationSurface.tsx:363` `✓` → `Check`; `:386` `⚡`/`⏳` → `Zap`/`Clock`;
`:424` `▼` → `ChevronDown` (stroke 1.5, `currentColor`).

## Nits

- `ArbiterSettings.tsx:171-186` reorder buttons → min 36px hit area (`p-2` on a
  `size={16}` icon, or explicit `h-9 w-9`).
- `p-5` → `p-4` on the arbiter cards; arbitrary `rounded`/`rounded-md` → the
  `rounded-[6px]` / `rounded-[10px]` scale.

## Files touched (Phase A)

`design-system/tokens.css`, `ui/src/index.css`,
`ui/src/components/energy/ArbitrationSurface.tsx`,
`ui/src/components/energy/LiveEnergyPage.tsx`,
`ui/src/components/energy/EnergyBarChart.tsx`,
`ui/src/components/energy/ProductionBarChart.tsx`,
`ui/src/components/settings/ArbiterSettings.tsx`,
`ui/src/components/energy/arbiterColors.ts` (+ `.test.ts`).

No backend, no API, no data-model change in Phase A.

## Phase B (separate spec/PR)

New `GET /api/v1/energy/arbiter/timeline?window=…` returning, for the requested
6h window (paged back to 48h): per-load state intervals reconstructed from the
persisted arbiter journal (spec 147) + the signed surplus/deficit series
(persisted ≥48h or derived from InfluxDB at 15-min). New timeline React component
consuming it, with the interactions validated in the design (quarter-hour cells,
kW-scaled signed curve, 6h/48h navigation, click→journal).
