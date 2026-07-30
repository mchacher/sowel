# Architecture — Spec 132

Single repository change (core UI only). No database, no event, no API change.

## Data model

No change to `EquipmentType` or the `DataBinding` schema. `addDataBinding`
already accepts an arbitrary `alias` string (`src/api/routes/equipments.ts`,
`POST /api/v1/equipments/:id/data-bindings`) — `power_l1`/`power_l2`/`power_l3`
are just aliases like any other, bound by whichever plugin/operator chooses to
expose per-phase power on a `main_energy_meter` equipment.

## UI

### `ui/src/components/energy/phase-helpers.ts` (new, pure logic)

Extracted from the component so it can be unit-tested (per project
convention: "no React tests in this project" — but pure helpers are tested,
mirroring `submeter-helpers.ts` / `productionTotal.ts`).

```ts
export interface PhaseValue { n: number; power: number }

export function extractPhases(equipments: EquipmentWithDetails[]): PhaseValue[]
```

Scans every `main_energy_meter`-eligible equipment's `dataBindings` for
aliases matching `/^power_l(\d+)$/` with a numeric value, sums by phase
number across equipments, returns sorted by `n`.

### `ui/src/components/energy/PhaseBreakdown.tsx` (new)

```tsx
interface Props { gridEquipments: EquipmentWithDetails[] }
export function PhaseBreakdown({ gridEquipments }: Props)
```

- `phases = extractPhases(gridEquipments)`; returns `null` if
  `phases.length < 2`.
- Renders one row per phase: label (`Phase {n}`), a proportional bar
  (width = `power / maxPower`), formatted power value.
- Styling matches `LiveSubmeterBreakdown.tsx` (same card container, same
  `formatPower` convention: W below 1000, kW with 1 decimal above).

### `ui/src/components/energy/LiveEnergyPage.tsx` (modified)

Renders `<PhaseBreakdown gridEquipments={gridEqs} />` right after
`<LiveDiagram />` and before `<LiveSubmeterBreakdown />`. `gridEqs` is the
existing `equipments.filter(e => e.type === "main_energy_meter")` memo already
computed on this page — no new data fetching.

### i18n

`ui/src/i18n/locales/{fr,en}.json`: `energy.live.phases.title`,
`energy.live.phases.phase` (interpolated `{{n}}`).

## Why not `energy_meter`

See spec.md "Out of scope". Concretely: `submeter-helpers.ts`'s
`isSubmeterEquipment()` filters on `type === "energy_meter"` (+ metering
switches, spec 129), and `power-submeter-integrator.ts` independently
integrates W→Wh for exactly that same equipment set into InfluxDB, which then
feeds `/api/v1/energy/by-usage`'s residual computation
(`Autre = Total − Σ submeters`). Binding phases through that type would pull
them into both places, both wrongly.

## File changes

| File                                                     | Change                          |
| --------------------------------------------------------- | -------------------------------- |
| `ui/src/components/energy/phase-helpers.ts`                | New — pure extraction logic     |
| `ui/src/components/energy/phase-helpers.test.ts`           | New — unit tests                |
| `ui/src/components/energy/PhaseBreakdown.tsx`               | New — presentational component  |
| `ui/src/components/energy/LiveEnergyPage.tsx`               | Render `<PhaseBreakdown />`      |
| `ui/src/i18n/locales/fr.json`, `ui/src/i18n/locales/en.json` | New translation keys            |
| `specs/132-three-phase-live-breakdown/*`                    | This spec                       |
