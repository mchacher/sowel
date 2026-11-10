# Plan — Spec 200

## Tasks

1. [x] Types in `src/shared/types.ts` and `ui/src/types.ts`.
2. [x] Migration `043_arbiter_daily_gain.sql`; `ArbiterGainStore`; `BACKUP_TABLES`.
3. [x] `ArbiterGainMeter`; wiring in `src/index.ts` (start, graceful stop).
4. [x] `src/energy/bilan.ts` pure computations.
5. [x] Extract `loadEnergyPoints` and `loadUsagePartition` in `energy.ts` (no output change); route `GET /api/v1/energy/bilan`.
6. [x] Tests (below).
7. [x] UI: selector `periods`, route, nav entries, `BilanPage`, `BilanChart`, `bilan-format`, i18n EN/FR.
8. [x] Docs delta (EN + FR) and specs index rows. Screenshots deferred: never taken on production, they come from a demo instance in a follow-up.
9. [x] Visual check against the mockup, desktop and phone, light and dark, on prod data (vite preview proxied read-only, `/energy/bilan` computed locally by this branch's code from prod reads, captures kept out of the repo). It caught the partial-month comparison (April 2025, meter installed late in the month), fixed by the coverage rule of FR3.

## Test Plan

### Modules to test

- `src/energy/bilan.ts`
- `src/energy/arbiter-gain-meter.ts`
- `src/energy/arbiter-gain-store.ts`
- `src/api/routes/energy.ts` (bilan route, and the two extracted loaders through the existing route tests)
- `src/backup/backup-manager.ts` (table round trip)
- `ui/src/components/energy/bilan-format.ts`

### Scenarios

| Module             | Scenario                                                                | Expected                                                                  |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| bilan              | Point with consumption and self-consumption                             | paidHp + paidHc = grid-side cost; avoided = autoconso × point rate        |
| bilan              | Period of points                                                        | Σ paid = `computeTotals().cost_total`; bill + avoided = Σ point cost      |
| bilan              | Point with zero consumption                                             | all zero, no NaN                                                          |
| bilan              | Self-consumption above consumption                                      | share clamped to 1, avoided = point cost, paid 0                          |
| bilan              | Day comparison, 7 days of which 2 empty                                 | average over the 5 with consumption                                       |
| bilan              | Day comparison, all 7 empty                                             | null                                                                      |
| bilan              | Month current, day 10 of 30                                             | projection = bill × 30 / elapsed (time-based)                             |
| bilan              | Month current, day 2                                                    | projection null                                                           |
| bilan              | Month past                                                              | projection null; previous year when it has data, else null                |
| bilan              | Year: prev year has data May–Dec, current year at Nov 10                | comparable months May–Oct; Nov excluded (not elapsed)                     |
| bilan              | Year: no comparable month                                               | null                                                                      |
| bilan              | Year: previous year's April has 3 days of data                          | April left out of the comparison and without a tick                       |
| bilan              | Usage rows                                                              | per-point split; Σ paid of rows = bill when rows cover the main meter     |
| bilan              | Arbiter tile: period before since / straddling / after                  | measured none / partial / full                                            |
| arbiter-gain-meter | Two granted loads 1000 W and 500 W, export 200 W, 60 s                  | 1500 W solar split 1000/500 → 16.67 Wh / 8.33 Wh, € at tariff of the time |
| arbiter-gain-meter | Same loads, import 600 W                                                | S = 900 W split 600/300                                                   |
| arbiter-gain-meter | Import above the granted draw                                           | nothing booked                                                            |
| arbiter-gain-meter | `granted-idle`, pending, unmanaged loads                                | not counted                                                               |
| arbiter-gain-meter | Arbiter disabled or `availableSurplusW` null                            | nothing booked, next sample does not book the gap                         |
| arbiter-gain-meter | Gap of 10 min between samples                                           | dt capped at 120 s                                                        |
| arbiter-gain-meter | Sample crossing a tariff boundary                                       | € split by the classifier                                                 |
| arbiter-gain-meter | Sample before and after local midnight                                  | rows on two days                                                          |
| arbiter-gain-meter | flush, then pending()                                                   | rows in the store, pending empty                                          |
| arbiter-gain-meter | stop()                                                                  | flushes                                                                   |
| arbiter-gain-meter | First enabled sample                                                    | `energy.arbiterGain.since` written once, never overwritten                |
| arbiter-gain-meter | getPublicState throws                                                   | logged, no throw                                                          |
| arbiter-gain-store | Two adds on the same (day, equipment)                                   | summed                                                                    |
| arbiter-gain-store | range inclusive bounds                                                  | rows of the bounds included                                               |
| energy route       | `/energy/bilan` invalid period / no main meter / no Influx              | 400 / 404 / 503                                                           |
| energy route       | `/energy/bilan?period=day` on mocked Influx                             | bill = history totals; comparison over the 7 previous days                |
| energy route       | Existing `/energy/history` and `/energy/by-usage` tests                 | still green after the extraction                                          |
| backup             | Export then restore with `arbiter_daily_gain` rows                      | rows restored                                                             |
| bilan-format       | Labels for today / past day / current month / past month / current year | the FR2 strings                                                           |
| bilan-format       | Year comparison contiguous vs not                                       | range sentence vs count sentence; sign of the percentage                  |
| bilan-format       | Arbiter tile states                                                     | "pas encore mesuré", "mesuré depuis le …", top two loads                  |

The core scenario (paid + avoided = point cost) is broken once on purpose to see its test fail.
