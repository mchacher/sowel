# Spec 117 — Architecture

## Overview

100% frontend, no backend change. The Live page already subscribes to
`equipment.data.changed` and re-renders on every change. We add a new
component `LiveSubmeterBreakdown` that consumes the same Zustand store
(`useEquipments`) and renders an SVG donut + legend below the existing
diagram.

```
WS equipment.data.changed
  → useEquipments store (existing)
    → LiveEnergyPage (existing) re-renders
      → LiveDiagram (existing)
      → LiveSubmeterBreakdown (NEW)
          ↓
        derive submeters[] from equipments.filter(type === "energy_meter")
        derive house from gridPower + solarPower (or Σ submeters)
        compute "Autre" = house - Σ submeter power, clamp ≥ 0
        sort submeters by power desc, offline last
        render SVG donut + legend
```

## Data model

Nothing new. Reuses existing types:

- `EquipmentWithDetails` already includes `dataBindings` (with `alias`
  and `value`) and `status` / `statusReason` (spec 116).
- `energy_meter` type already defined in `src/shared/types.ts`.

No new event, no new table, no new migration.

## Frontend changes

### New file: `ui/src/components/energy/LiveSubmeterBreakdown.tsx`

```tsx
interface SubmeterRow {
  id: string;
  name: string;
  power: number | null; // null when binding missing / equipment offline
  status: EquipmentStatus; // online | degraded | offline
  offlineSince: string | null;
  color: string; // from SUBMETER_PALETTE
}

interface Props {
  /** house total in W; null if neither grid nor solar reported */
  house: number | null;
  /** has a main_energy_meter? controls whether "Autre" is rendered */
  hasMainMeter: boolean;
}

export function LiveSubmeterBreakdown(props: Props) {
  const equipments = useEquipments((s) => s.equipments);
  const submeters = useMemo(() => buildSubmeterRows(equipments), [equipments]);
  if (submeters.length === 0) return null;

  // ... derive "Autre", sort, render SVG ...
}
```

Pure functions to test (exported):

- `readSubmeterPower(eq: EquipmentWithDetails): number | null`
  — reads the `power` alias binding, returns `null` if missing or
  equipment is `offline`. Negative values are returned as their
  absolute value (clamp-wired-backwards edge case).
- `submeterColorByIndex(sortedIndex: number): string`
  — returns `SUBMETER_PALETTE[sortedIndex % 8]`.
- `buildSubmeterRows(equipments: EquipmentWithDetails[]): SubmeterRow[]`
  — filters `type === "energy_meter"`, sorts by `id`, assigns color
  by index, then re-sorts the resulting array by `power` descending
  (offline/null last) for display.
- `computeOther(house: number, submeters: SubmeterRow[]): number`
  — `max(0, house - Σ submeter.power)`.

### Color palette source

Move `SUBMETER_PALETTE` from `src/api/routes/energy.ts:714` to a
shared frontend-accessible location to keep the contract single-source
without duplication risk:

- New file: `ui/src/components/energy/submeterPalette.ts`
  exports `SUBMETER_PALETTE` (the same 8 hex codes) and
  `pickSubmeterColor(sortedIndex)`.
- Backend `src/api/routes/energy.ts` continues to own its copy with
  the same hex codes. We accept the minor duplication: the palette is
  static, never changes at runtime, and centralizing it would require
  a backend-imports-from-frontend pattern that does not exist in this
  repo. A code comment in both files cross-references the other.

### SVG donut

Custom SVG (no charting library — keeps Live page lightweight and
consistent with the rest of the diagram which is also hand-rolled SVG).

```
viewBox: 0 0 200 200
center: (100, 100), r=72, stroke-width=22

For each segment (sorted by power desc):
  - dasharray = (power / total) * circumference
  - dashoffset = -Σ previous dasharrays
  - <circle> with stroke=color, stroke-dasharray, stroke-dashoffset
Center: <foreignObject> or absolute-positioned <div> with house total

Transition: CSS `transition: stroke-dasharray 300ms ease,
                              stroke-dashoffset 300ms ease;` on each
circle. Bubbles in the existing diagram are animated via SMIL — the
donut animates via CSS transitions, simpler and good enough for ~1 Hz
updates.
```

### Integration into `LiveEnergyPage.tsx`

After the existing `<LiveDiagram>` render block:

```tsx
const hasMainMeter = gridEqs.length > 0;
const houseW =
  gridPower !== null || solarPower !== null
    ? Math.max(0, (gridPower ?? 0) + (solarPower ?? 0))
    : null;

// ... existing render ...

{
  hasSources && <LiveSubmeterBreakdown house={houseW} hasMainMeter={hasMainMeter} />;
}
```

The component returns `null` if no submeter exists — no extra guard
needed at the parent level.

### i18n keys

Add to `ui/src/i18n/locales/en.json` and `fr.json`:

```json
"energy.live.breakdown.title": "Décomposition consommation" / "Consumption breakdown"
"energy.live.breakdown.other": "Autre" / "Other"
"energy.live.breakdown.offline": "hors-ligne" / "offline"
"energy.live.breakdown.offlineSince": "depuis {{when}}" / "since {{when}}"
"energy.live.breakdown.noData": "pas de mesure" / "no measurement"
"energy.live.breakdown.houseIdle": "Maison à l'arrêt" / "House idle"
"energy.live.breakdown.overshoot": "Σ sous-compteurs ≥ total maison" / "Σ submeters ≥ house total"
```

### Layout

Desktop (≥ 520 px):

```
┌─────────────────────────────────────┐
│ Existing diagram (unchanged)        │
└─────────────────────────────────────┘
┌─ Décomposition consommation ────────┐
│  ┌─ Donut ─┐  ● PAC      1450 W 45%│
│  │  3.2    │  ● Piscine   620 W 19%│
│  │   kW    │  ● Voiture   280 W  9%│
│  │ MAISON  │  ● Cuisine   220 W  7%│
│  └─────────┘  ○ Autre     630 W 20%│
└─────────────────────────────────────┘
```

Mobile (< 520 px): donut centered on top, legend full-width below.

### File-level impact

| File                                                     | Change                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ui/src/components/energy/LiveSubmeterBreakdown.tsx`     | NEW — main component                                                                        |
| `ui/src/components/energy/submeterPalette.ts`            | NEW — shared color palette helper                                                           |
| `ui/src/components/energy/LiveEnergyPage.tsx`            | Add `<LiveSubmeterBreakdown />` after `<LiveDiagram />` and compute `houseW`/`hasMainMeter` |
| `ui/src/i18n/locales/en.json`                            | New `energy.live.breakdown.*` keys                                                          |
| `ui/src/i18n/locales/fr.json`                            | New `energy.live.breakdown.*` keys                                                          |
| `ui/src/components/energy/LiveSubmeterBreakdown.test.ts` | NEW — unit tests on the pure helpers                                                        |
| `src/api/routes/energy.ts:714`                           | Add cross-reference comment to the UI palette file (no logic change)                        |

### Performance

- Live page already re-renders on every `equipment.data.changed`.
  Adding the donut adds N circle elements (typically 2-5) and a small
  DOM update per render — negligible.
- All derivations are `useMemo`-wrapped to avoid recomputing on
  re-renders that don't change the equipments list.
- No new network call, no new WS subscription.

### Accessibility

- Donut has `role="img"` and `aria-label` summarizing the breakdown:
  `"3.2 kW total — PAC 45%, Piscine 19%, Voiture 9%, Cuisine 7%, Autre 20%"`.
- Each legend row is a regular `<div>` with semantic text; screen
  readers read it linearly. No interactive elements (consistent with
  the existing diagram which is also read-only).

### Backward compatibility

- A user with no `energy_meter` sees no change (component returns `null`).
- A user already on the Live page sees the new section appear under
  the diagram. No setting to toggle.
- No data model change, so backup/restore is unaffected.
- No new build dependency.
