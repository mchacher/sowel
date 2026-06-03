# Spec 123 — Architecture

## Data flow (read-only, no write-path change)

```
Energy page (UI)
  ├── viewMode=total → GET /api/v1/energy/history?period=...&date=...
  │       └── computeCosts(points, totals, prices) → response includes cost_*
  │
  └── viewMode=by-usage → GET /api/v1/energy/by-usage?period=...&date=...
          ├── Internal: re-derive total_hp / total_hc / cost_hp / cost_hc
          │     for the same window (single shared helper)
          ├── blendedRate = cost_total_€ / consumption_kWh
          └── per submeter & other: cost = wh / 1000 × blendedRate
```

No InfluxDB schema change, no SQLite migration, no new event types, no WebSocket additions. Pure read-path computation.

## Type changes (`src/shared/types.ts`)

```ts
export interface EnergyPoint {
  time: string;
  hp: number;
  hc: number;
  prod: number;
  autoconso: number;
  injection: number;
  // NEW (spec 123)
  cost_hp: number; // €
  cost_hc: number; // €
  cost_total: number; // €
}

export interface EnergyTotals {
  total_consumption: number;
  total_hp: number;
  total_hc: number;
  total_production: number;
  total_autoconso: number;
  total_injection: number;
  // NEW (spec 123)
  cost_hp: number; // €
  cost_hc: number; // €
  cost_total: number; // €
}

export interface SubmeterSeries {
  id: string;
  name: string;
  color: string;
  points: EnergyByUsagePoint[];
  // NEW (spec 123)
  cost: number; // € for the whole series
}

export interface EnergyByUsageResponse {
  // ...existing fields unchanged...
  totals: {
    byEquipment: Record<string, number>;
    other: number;
    total: number;
    // NEW (spec 123)
    costByEquipment: Record<string, number>;
    otherCost: number;
    totalCost: number;
  };
}
```

`TariffConfig` / `TariffPrices` / `TariffSplit` shapes are **unchanged**.

User preferences blob (already exists, see `src/users/`):

```ts
preferences.energy.unit: "wh" | "eur"   // default "wh"
```

## Backend changes

### New helper: `src/energy/cost-calculator.ts`

Pure, dependency-free module. Shared between the two route handlers and unit-tested in isolation.

```ts
export interface CostBreakdown {
  cost_hp: number;
  cost_hc: number;
  cost_total: number;
}

export function computeCost(hpWh: number, hcWh: number, prices: TariffPrices): CostBreakdown;

export function blendedRate(totalConsumptionWh: number, costTotalEur: number): number; // €/kWh, 0 if denominator is 0
```

Both functions clamp to 4-decimal rounding via `Math.round(x * 10_000) / 10_000`.

### `src/api/routes/energy.ts` — `/energy/history`

After building `points` and `totals`, fetch `prices` once via `tariffClassifier.getConfig()?.prices ?? { hp: 0, hc: 0 }`, then:

- For each `EnergyPoint`: add `cost_hp` / `cost_hc` / `cost_total` via `computeCost`.
- For totals: same. `totals.cost_total = totals.cost_hp + totals.cost_hc`.

`EnergyHistoryResponse` shape mirrors the type changes above. No new query parameter, no new endpoint.

### `src/api/routes/energy.ts` — `/energy/by-usage`

Currently this route does not query `energy_hp` / `energy_hc`. To get the blended rate without a second round-trip to its own implementation, factor the history totals computation into a helper:

```ts
// In src/api/routes/energy.ts (or a sibling file)
async function computeConsumptionTotalsForWindow(
  ...,
): Promise<{ total_hp_wh, total_hc_wh, cost_hp, cost_hc, cost_total }>;
```

Then in `/energy/by-usage`:

1. Compute consumption totals for the same window (1 reused helper call).
2. `blendedRate(totalConsumptionWh, costTotalEur)`.
3. For each `SubmeterSeries`: `cost = sumOf(series.points.wh) / 1000 × blendedRate`, rounded.
4. `otherCost = sumOf(other.points.wh) / 1000 × blendedRate`.
5. `totalCost = Σ submeter costs + otherCost` (matches `total` × blendedRate, modulo rounding).

The blended rate is logged at `debug` (`{ blendedRate, period, date }`) to support invoice cross-checks.

### `/energy/status` — no change

`tariffConfigured` boolean is already enough for the UI to enable/disable the toggle. We MUST verify `prices.hp > 0 || prices.hc > 0` (currently it only checks the setting blob exists). If today's check is `setting !== null`, tighten it to `(setting?.prices.hp ?? 0) > 0 || (setting?.prices.hc ?? 0) > 0`.

## Frontend changes

### `ui/src/store/useEnergy.ts`

- Reflect the new response fields in the Zustand store types.
- No fetch / refetch change; existing polling cadence preserved.

### `ui/src/store/usePreferences.ts` (or equivalent)

Add `energy.unit` with default `"wh"`. Persist via the existing `PUT /users/me/preferences` round-trip.

### `ui/src/components/energy/EnergyPage.tsx`

- New `UnitToggle` component in `ui/src/components/energy/UnitToggle.tsx` — segmented `Wh | €` mirroring the existing `viewMode` segmented control's design tokens.
- Render in the page header next to the existing period / date controls.
- Disabled state when `status.tariffConfigured === false`, tooltip via `title=` attribute.
- The `formatKWh` helper is generalized to a `formatEnergyOrCost(value, unit, period)` that:
  - In `wh` mode, behaves like the current `formatKWh`.
  - In `eur` mode, formats with `Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 2 })`.
- All `kWh` strings in the totals card, bar chart Y axis, tooltip, and by-usage donut/stacked bar legend route through this helper.

### `ui/src/components/energy/LiveEnergyPage.tsx`

Shared `unit` preference applies. The donut needs a blended rate — read from the day's `/energy/history?period=day&date=today` response (already fetched on the live page or, if not, add one fetch on mount and refresh once per minute alongside the existing poll).

### `ui/src/components/settings/TariffSettings.tsx`

Add a `<p className="text-xs text-text-muted mt-2">` under the price inputs with the hint from R5. i18n keys: `settings.tariff.priceRetroactiveHint`.

### `ui/src/i18n/*`

Add keys (both FR and EN):

```
energy.unit.wh = "Wh" / "Wh"
energy.unit.eur = "€" / "€"
energy.unit.tariffMissing = "Configurez les prix HP/HC dans Réglages > Tarif"
                          / "Configure HP/HC prices in Settings > Tariff"
settings.tariff.priceRetroactiveHint = "These prices value..." (EN/FR)
```

## File touch list

| File                                                        | Change                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                                       | Extend `EnergyPoint`, `EnergyTotals`, `SubmeterSeries`, `EnergyByUsageResponse.totals`    |
| `src/energy/cost-calculator.ts`                             | NEW — `computeCost`, `blendedRate`                                                        |
| `src/energy/cost-calculator.test.ts`                        | NEW — unit tests (see plan)                                                               |
| `src/api/routes/energy.ts`                                  | Wire costs into both routes; tighten `tariffConfigured`; factor consumption-totals helper |
| `src/api/routes/energy.test.ts` (if it exists, else create) | Route-level tests for cost fields                                                         |
| `ui/src/store/useEnergy.ts`                                 | Type updates                                                                              |
| `ui/src/store/usePreferences.ts`                            | Add `energy.unit`                                                                         |
| `ui/src/components/energy/UnitToggle.tsx`                   | NEW                                                                                       |
| `ui/src/components/energy/EnergyPage.tsx`                   | Render toggle, route formatting through new helper                                        |
| `ui/src/components/energy/EnergyBarChart.tsx`               | Honor unit prop                                                                           |
| `ui/src/components/energy/EnergyByUsageChart.tsx`           | Honor unit prop                                                                           |
| `ui/src/components/energy/LiveEnergyPage.tsx`               | Honor unit, fetch blended rate                                                            |
| `ui/src/components/settings/TariffSettings.tsx`             | Retroactivity hint                                                                        |
| `ui/src/i18n/fr.json`, `ui/src/i18n/en.json`                | New keys                                                                                  |
| `docs/release-notes.md`, `docs/release-notes.fr.md`         | Version entry                                                                             |
| `docs/user/energy.md` (if exists)                           | Update user-facing doc                                                                    |

## Error handling

- Cost computation never throws: invalid inputs (NaN, undefined prices) coerce to 0.
- The route handlers' existing `try/catch` envelopes are reused; the cost wiring lives inside the existing try block.
- UI: a missing `cost_*` field on a (forwards-compat) response is treated as 0 by the formatter, never as `NaN`.

## Performance

- One additional in-memory pass per `points[]` (O(n) where n ≤ ~288 for a day at 5min).
- No extra Influx queries.
- The `/energy/by-usage` route reuses the consumption-totals helper without duplicating queries.
