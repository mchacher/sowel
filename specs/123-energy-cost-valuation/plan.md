# Spec 123 — Implementation plan

## Tasks (in strict order)

### Backend

1. [x] Extend `src/shared/types.ts`: `EnergyPoint`, `EnergyTotals`, `SubmeterSeries`, `EnergyByUsageResponse.totals`.
2. [x] Create `src/energy/cost-calculator.ts` with `computeCost(hpWh, hcWh, prices)` and `blendedRate(totalWh, costEur)`.
3. [x] Create `src/energy/cost-calculator.test.ts` (see test plan §1).
4. [x] In `src/api/routes/energy.ts` /energy/history:
   - Fetch `prices` once (default `{ hp:0, hc:0 }`).
   - Wire `cost_hp` / `cost_hc` / `cost_total` into each point and into `totals` via `computeCost`.
5. [x] In `src/api/routes/energy.ts` /energy/by-usage:
   - Factor a `computeConsumptionTotalsForWindow(...)` helper (shared with /history).
   - Compute `blendedRate` once.
   - Add per-submeter `cost`, `totals.costByEquipment`, `totals.otherCost`, `totals.totalCost`.
6. [x] Tighten `tariffConfigured` on `/energy/status` to require `(prices.hp > 0 || prices.hc > 0)`.
7. [x] Route-level tests for cost wiring (see test plan §2).

### Frontend

8. [x] Reflect new fields in `ui/src/store/useEnergy.ts` types.
9. [x] Add `energy.unit` to user preferences store + persistence round-trip.
10. [x] Create `ui/src/components/energy/UnitToggle.tsx` (segmented Wh / €).
11. [x] Generalize `formatKWh` → `formatEnergyOrCost(value, unit, period)` in `EnergyPage.tsx` (or extract to `ui/src/components/energy/format.ts`).
12. [x] Wire toggle into `EnergyPage.tsx` header; disabled state when `!tariffConfigured`.
13. [x] Update `EnergyBarChart.tsx`, `EnergyByUsageChart.tsx`, `LiveEnergyPage.tsx` to honor the unit.
14. [x] Add retroactivity hint in `TariffSettings.tsx`.
15. [x] FR + EN i18n keys.

### Docs & release

16. [x] Update `docs/user/energy.md` (Wh/€ toggle, retroactive pricing note).
17. [x] Update `docs/technical/api-reference.md` (new fields on /energy/history + /energy/by-usage).
18. [x] Add release-notes entry in `docs/release-notes.md` and `docs/release-notes.fr.md` BEFORE bumping version (spec 108 enforcement).
19. [x] Mark acceptance criteria `[x]` in spec.md, tasks `[x]` in plan.md.

### Validate

20. [x] `npx tsc --noEmit` (backend) — zero errors.
21. [x] `cd ui && npx tsc -b --noEmit` — zero errors.
22. [x] `npx vitest run` — all tests pass.
23. [x] `npx eslint src/ --ext .ts` — zero errors.

---

## Test Plan

### Modules to test

- `src/energy/cost-calculator.ts` — pure unit
- `src/api/routes/energy.ts` — `/energy/history` and `/energy/by-usage` cost wiring

### §1 — `cost-calculator.test.ts`

| Scenario                                                | Expected                                            |
| ------------------------------------------------------- | --------------------------------------------------- |
| `computeCost(1000, 0, { hp: 0.2, hc: 0.1 })`            | `{ cost_hp: 0.2, cost_hc: 0, cost_total: 0.2 }`     |
| `computeCost(500, 500, { hp: 0.2, hc: 0.1 })`           | `{ cost_hp: 0.1, cost_hc: 0.05, cost_total: 0.15 }` |
| `computeCost(1000, 1000, { hp: 0, hc: 0 })`             | All fields = 0                                      |
| `computeCost(0, 0, { hp: 0.2, hc: 0.1 })`               | All fields = 0                                      |
| `computeCost(NaN, 0, prices)`                           | All fields = 0 (defensive)                          |
| `computeCost(1234, 5678, { hp: 0.23456, hc: 0.12345 })` | Result rounded to 4 decimals                        |
| `blendedRate(10_000, 2.0)`                              | `0.2` (€/kWh)                                       |
| `blendedRate(0, 0)`                                     | `0` (no division by zero)                           |
| `blendedRate(1000, 1.5)`                                | `1.5` (€/kWh)                                       |

### §2 — `energy.ts` route tests

Uses the existing route test scaffolding (mock InfluxDB client). If `energy.test.ts` does not exist, create it following the pattern in `src/api/routes/*.test.ts`.

| Module    | Scenario                                      | Expected                                                          |
| --------- | --------------------------------------------- | ----------------------------------------------------------------- |
| /history  | Tariff configured, normal day data            | Each point has `cost_hp`/`cost_hc`/`cost_total`, totals computed  |
| /history  | Tariff missing (`energy.tariff` setting null) | Every cost field = 0; 200 response                                |
| /history  | Prices both 0                                 | Every cost field = 0; 200 response                                |
| /history  | Empty points (no data)                        | totals.cost\_\* = 0                                               |
| /by-usage | One submeter + main meter with data           | submeter has `cost` matching `wh / 1000 × blendedRate`            |
| /by-usage | Main meter total = 0 (no consumption window)  | All submeter costs = 0; no NaN                                    |
| /by-usage | No main meter equipment                       | blendedRate uses Σ submeters' kWh; submeter cost still consistent |
| /by-usage | Tariff missing                                | All cost fields = 0; 200 response                                 |

### §3 — Retro-compat checks

| Module    | Scenario                                                       | Expected                                                                                      |
| --------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| /history  | Existing fields (`hp`, `hc`, `prod`, …) unchanged              | Field values match pre-spec-123 behaviour byte-for-byte                                       |
| /by-usage | Existing `submeters[*].points`, `totals.byEquipment` unchanged | Same                                                                                          |
| /status   | `tariffConfigured` semantics tightened (prices > 0)            | Pre-existing UI guard still works; legacy behaviour documented in release notes if it changes |

### §4 — Manual verification before merging

- Energy page Day view: toggle Wh → € shows reasonable € total matching `consumption_kWh × ((prices.hp + prices.hc) / 2)` order-of-magnitude.
- Energy page By usage view: sum of submeter € + Other € ≈ total € (within 1 cent of rounding error).
- LiveEnergyPage: donut numbers swap unit consistently.
- TariffSettings: change `prices.hp` from 0.20 to 0.25, reload Energy page → past costs reflect new price.
- TariffSettings: hint visible under the price inputs.
- Toggle disabled when prices both 0; tooltip shown on hover.
