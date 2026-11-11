# Architecture — Spec 207

## Types

```ts
// src/shared/types.ts
export interface BilanEnergy {
  /** Wh bought from the grid, peak and off-peak (the /energy/history totals). */
  gridHpWh: number;
  gridHcWh: number;
  /** Self-consumed solar, each point clamped to its consumption. */
  solarWh: number;
  /** Grid plus self-consumed solar. */
  consumedWh: number;
}

export type BilanComparison =
  | { kind: "days"; days: number; averageBill: number; averageGridWh: number }
  | {
      kind: "month";
      projectedBill: number | null;
      previousYearBill: number | null;
      projectedGridWh: number | null;
      previousYearGridWh: number | null;
      /** Both months covered, but for MAX_MISSING_DAYS (the year view's rule). */
      comparable: boolean;
    }
  | {
      kind: "year";
      months: string[];
      bill: number;
      previousYearBill: number;
      gridWh: number;
      previousYearGridWh: number;
    };

export interface EnergyBilanResponse {
  // …existing fields
  energy: BilanEnergy;
}
```

## Backend

`src/energy/bilan.ts`:

- `gridWhOf(points)`: the grid Wh of points, `(hp + hc) × (1 − share)` per point with the share `splitPoint`
  already computes (history points carry the whole house's consumption; totals are grid-only).
- `dayComparison`, `monthComparison`, `yearComparison` compute the Wh fields next to the € ones, over the same
  points and the same rules (the projection uses the same elapsed ratio).
- `computeBilan` fills `energy` from `totals` (`total_hp`, `total_hc`) and `solarWhOf(points)`, the per-point
  `min(autoconso, hp + hc)`.

No route change beyond the type: everything comes from data the route already reads.

## UI

- `ui/src/types.ts`: the types.
- `ui/src/components/energy/bilan-format.ts`: `energyLines(data, …)` (the sentence, the share),
  `energyComparisonLines(comparison, …)` (kWh lines per kind), `averagePrice(data)` (null without grid kWh). Pure, tested.
- `BilanPage.tsx`: `BillCard` splits into a euro column and an `EnergyColumn`; on phone two `card` sections;
  the `Tiles` solar tile takes « Sans panneaux… ».
- Strings EN and FR.

## Files

| File                                                | Change                              |
| --------------------------------------------------- | ----------------------------------- |
| `src/shared/types.ts`                               | `BilanEnergy`, comparison Wh fields |
| `src/energy/bilan.ts` (+ test)                      | `gridWhOf`, comparisons, `energy`   |
| `src/api/routes/energy.test.ts`                     | response carries `energy`           |
| `ui/src/types.ts`                                   | types                               |
| `ui/src/components/energy/bilan-format.ts` (+ test) | kWh lines, average price            |
| `ui/src/components/energy/BilanPage.tsx` (+ test)   | kWh column, phone cards, solar tile |
| `ui/src/i18n/locales/{en,fr}.json`                  | strings                             |
| docs                                                | see `spec.md`                       |
