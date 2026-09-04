# Spec 175 — Implementation plan

Branch: `feat/cadence-derived-freshness`

## Steps

1. **Types** — `freshnessBudgetMs?: number` on `DataBindingWithValue` (`src/shared/types.ts`).
2. **Shared rule** — `resolveFreshnessBudget` plus the three constants in
   `src/shared/reading-freshness.ts`. Delete `powerBudgetFor`, the `demand_5min` entry of
   `LIVE_POWER_ALIASES` and the `solar_panel` branch. Update `reading-freshness.test.ts`.
3. **Tracker** — `src/devices/reading-cadence.ts` (ring buffer, median, `MIN_SAMPLES`).
4. **Arrivals** — `DeviceManager` records on every value write and forgets a deleted `device_data`
   row.
5. **Annotation** — `EquipmentManager.getDataBindingsWithValues` sets the budget on power bindings,
   from the `DeviceManager` and `IntegrationRegistry` it already holds (no injected provider: see
   the architecture note).
6. **Backend consumers** — `zone-aggregator.ts` and `routes/equipments.ts` read the binding field.
7. **UI consumers** — `power-reading.ts`, `live-staleness.ts`, `submeter-helpers.ts`.
8. **Docs** — the new binding field in `docs/technical/api-reference.md` and `.fr.md`.
9. **Index** — a row for spec 175 in `docs/specs-index.md` AND `docs/specs-index.fr.md` (the
   pull-request gate added by #886 fails without both).

Order matters: 1-2 leave the tree compiling with every consumer still on the fallback, so 7-8 can be
verified one surface at a time.

## Test Plan

### Modules to test

- `src/devices/reading-cadence.ts` — the estimator
- `src/shared/reading-freshness.ts` — budget resolution
- `src/equipments/equipment-manager.ts` — annotation on the payload
- `src/zones/zone-aggregator.ts` — the total honours the per-binding budget
- `src/api/routes/equipments.ts` — the `?role=submeter` feed honours it
- `ui/src/lib/power-reading.ts`, `ui/src/components/energy/live-staleness.ts`,
  `ui/src/components/energy/submeter-helpers.ts` — the three UI surfaces (ui tier, `cd ui && npx vitest run`)

### Scenarios

| Module            | Scenario                                             | Expected                                            |
| ----------------- | ---------------------------------------------------- | --------------------------------------------------- |
| reading-cadence   | 5 arrivals 1 s apart                                 | `observedIntervalMs` = 1000                         |
| reading-cadence   | 2 arrivals only                                      | `null` (below `MIN_SAMPLES`)                        |
| reading-cadence   | 10 arrivals 1 s apart, then a 6 h gap                | median still 1000, unchanged by the outlier         |
| reading-cadence   | 12 arrivals, ring of 10                              | oldest intervals evicted, median follows the recent |
| reading-cadence   | `forget()` then query                                | `null`                                              |
| reading-cadence   | two rows recorded in parallel                        | independent series, no cross-talk                   |
| reading-freshness | observed 1 s                                         | 120 000 (floor)                                     |
| reading-freshness | observed 300 s                                       | 750 000                                             |
| reading-freshness | observed 3600 s                                      | 1 800 000 (ceiling)                                 |
| reading-freshness | declared 300 s, nothing observed                     | 750 000                                             |
| reading-freshness | observed 60 s AND declared 300 s                     | 150 000 (observed wins)                             |
| reading-freshness | neither                                              | 600 000 (learning)                                  |
| reading-freshness | `LIVE_POWER_ALIASES`                                 | `["power"]`, no `demand_5min`                       |
| equipment-manager | power binding, integration declares a poll interval  | `freshnessBudgetMs` = 2.5 x that interval           |
| equipment-manager | temperature binding                                  | no `freshnessBudgetMs` (power only)                 |
| equipment-manager | power binding, nothing observed and nothing declared | learning window, nothing throws                     |
| equipment-manager | `stale` (spec 116) unchanged for every category      | regression: existing status tests still pass        |
| zone-aggregator   | submeter at 300 s cadence, 3 min silent              | counted (was dropped)                               |
| zone-aggregator   | submeter at 1 Hz cadence, 3 min silent               | dropped                                             |
| zone-aggregator   | binding without `freshnessBudgetMs`                  | learning window, same result as today               |
| routes/equipments | `?role=submeter`, 300 s source 3 min silent          | `powerReadingCurrent: true`                         |
| power-reading     | 300 s source 3 min silent                            | verdict `current` (was `stale`)                     |
| power-reading     | 1 Hz source 3 min silent                             | verdict `stale`                                     |
| live-staleness    | 300 s source 3 min silent                            | no banner entry (unchanged behaviour, new reason)   |
| live-staleness    | 1 Hz source 3 min silent                             | banner entry `stale` (was silent for 10 min)        |
| submeter-helpers  | same two sources                                     | same verdicts as the other three surfaces           |

### Cross-surface test (FR3)

`ui/src/lib/power-freshness-agreement.test.ts` builds one equipment payload and asserts that
`resolvePowerReading`, `readSubmeterReading` and `detectLiveStaleness` return the same verdict, for a
1 Hz source and for a 300 s source, at three minutes of silence and on both sides of the budget's
edge. That is the acceptance criterion the whole spec exists for, and it belongs in one place rather
than four half-checks.

The fourth surface, the zone power total, is backend and cannot be imported from the UI tier; it
reads the same field off the same binding and is covered against the same two cadences in
`src/zones/zone-aggregator.test.ts`.

## Risks

- **A busy `record()` path.** It runs on every device value write. Keep it to a map lookup, a push
  and a shift; no allocation per call beyond the interval number.
- **A construction path producing budget-less bindings.** Mitigated by the optional field and the
  learning fallback everywhere it is read, and covered by the "falls back to the learning window"
  tests on both tiers.
- **Surfaces drifting again later.** The field is the guard: once the budget is data on the payload,
  a surface that wants a different one has to invent it visibly.
