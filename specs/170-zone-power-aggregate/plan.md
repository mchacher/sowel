# Spec 170 — Implementation plan

## Steps

1. **Types** — `powerTotal: number | null` on `ZoneAggregatedData` (`src/shared/types.ts`), mirrored in `ui/src/types.ts`.
2. **Aggregator** — in `src/zones/zone-aggregator.ts`:
   - `powerSum` / `powerHasData` in `Accumulator` + `emptyAccumulator`;
   - sum both in `mergeAccumulators`;
   - `accumulateEquipmentPower(acc, type, status, bindings)`, called from the equipment loop after the offline early-out;
   - `powerTotal` in the public projection, rounded to one decimal, `null` when `!powerHasData`;
   - one comparison in `aggregatedDataEqual`.
3. **Tests** — the scenarios below in `src/zones/zone-aggregator.test.ts`.
4. **UI** — `formatWatts` + the power pill in `ZoneAggregationPills.tsx`.
5. **Docs** — `docs/user/zones.md` + `.fr.md`. `docs/technical/data-model.md` names `ZoneAggregatedData` only in the event table, so it needs no change and has no `.fr.md` counterpart.
6. **Validate** — `npx tsc --noEmit`, `npm run typecheck:tests`, `npx vitest run`, `npx eslint src/ --ext .ts`, `cd ui && npx tsc -b --noEmit && npx eslint .`, `bash scripts/check-docs-parity.sh`, `bash scripts/check-docs-impact.sh`.

No database migration, no new API route, no new event type.

## Test Plan

### Modules to test

- `src/zones/zone-aggregator.ts` — the only module with new business logic. `metering.ts` and `reading-freshness.ts` are reused unchanged and already carry their own suites.

### Scenarios

| Module          | Scenario                                                  | Expected                                        |
| --------------- | --------------------------------------------------------- | ----------------------------------------------- |
| zone-aggregator | One `energy_meter` at 39.4 W in the zone                  | `powerTotal === 39.4`                           |
| zone-aggregator | Meter at 39.4 W + child-zone meter at 8.2 W               | `powerTotal === 47.6` (descendant roll-up)      |
| zone-aggregator | Zone with no metered equipment                            | `powerTotal === null` (not `0`)                 |
| zone-aggregator | Zone holding only a `main_energy_meter`                   | `powerTotal === null`                           |
| zone-aggregator | Zone holding only an `energy_production_meter`            | `powerTotal === null`                           |
| zone-aggregator | Metering `switch` (plug reporting `state` + `power`)      | contributes to the sum                          |
| zone-aggregator | Submeter whose `power` is older than its freshness budget | excluded; lone submeter ⇒ `powerTotal === null` |
| zone-aggregator | Submeter equipment `offline`                              | excluded; counted in `unavailableByCategory`    |
| zone-aggregator | `power` binding value is `null`                           | excluded (not a number)                         |
| zone-aggregator | `power` binding value is a boolean                        | excluded (a state, not a measurement)           |
| zone-aggregator | Two submeters both reading exactly 0 W                    | `powerTotal === 0` (measured, not `null`)       |
| zone-aggregator | Clamp mounted backwards reporting −250 W alongside +100 W | `powerTotal === -150` (no abs, no clamp)        |
| zone-aggregator | Float artefact (39.4 + 8.2 + 0.04 sums to 47.63999…)      | rounded to one decimal ⇒ 47.6                   |
| zone-aggregator | Power changes only                                        | `aggregatedDataEqual` false ⇒ event emitted     |

### Retro-compat

- Every existing `zone-aggregator.test.ts` scenario keeps passing: `powerTotal` is additive and no existing field changes.
- Zones with no meters — the overwhelming majority — gain a `null` field and no pill.

## Tasks

- [x] 1. Types (core + UI mirror)
- [x] 2. Aggregator (accumulator, merge, accumulate, public, equality)
- [x] 3. Tests — 14 scenarios above
- [x] 4. UI pill + `formatWatts`
- [x] 5. Docs EN + FR (`docs/user/zones`)
- [x] 6. Full validation suite green
- [x] 7. Diff reviewed against the Phase 5 checklist (see spec notes)
