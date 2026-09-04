# Spec 175 — Architecture

## Where the rule lives today, and why it moves

`classifyPowerReading(opts)` in `src/shared/reading-freshness.ts` is already the single classifier.
Its `budgetMs` argument is the seam: every surface passes a different one, computed locally.

```
                       budgetMs chosen per surface  ← the divergence
live-staleness.ts  ──┐  10 min
power-reading.ts   ──┤  powerBudgetFor(type, alias)
zone-aggregator.ts ──┤  powerBudgetFor(type, alias)
routes/equipments  ──┘  (default)
                        └──► classifyPowerReading()
```

After:

```
DeviceManager.updateDeviceData ──► ReadingCadenceTracker (in memory, per device_data id)
                                          │
IntegrationRegistry.getPollingInfo ───────┤
                                          ▼
                    resolveFreshnessBudget(observed, declared) ──► binding.freshnessBudgetMs
                                          │
            ┌───────────────┬─────────────┴────────────┬───────────────┐
   live-staleness    power-reading        zone-aggregator      routes/equipments
            └───────────────┴──────────────────────────┴───────────────┘
                        └──► classifyPowerReading({ budgetMs: binding.freshnessBudgetMs })
```

The budget is computed once, server-side, and carried. A surface can no longer disagree because it
no longer decides.

## New module — `src/devices/reading-cadence.ts`

```ts
/** How often a device_data row actually reports. */
export class ReadingCadenceTracker {
  /** Called on every value write, from DeviceManager. */
  record(deviceDataId: string, atMs: number): void;
  /** Median inter-arrival, or null before MIN_SAMPLES intervals are known. */
  observedIntervalMs(deviceDataId: string): number | null;
  /** Drop a row's history when the device_data row goes away. */
  forget(deviceDataId: string): void;
}
```

- Ring buffer of `SAMPLE_COUNT = 10` intervals per row, `Map<string, number[]>` plus the last
  arrival. Bounded by the number of bound device_data rows, so a few thousand numbers at most.
- `MIN_SAMPLES = 3` before `observedIntervalMs` answers anything.
- **Median, not mean.** Irregularity is the reason: one large gap among ten one-second intervals
  leaves the median at one second where a mean would drift toward the anomaly.
- **A silence past the ceiling starts the series again.** That is a discontinuity, not irregularity,
  and it is also the only defence against a database restore: `BackupManager` deletes `device_data`
  through raw SQL and reaches neither call site that calls `forget()`, so an id reused between the
  restored backup and the live process would otherwise splice two unrelated histories into one
  median (review finding). Restore does return `restartRequired`, but nothing forces the restart.

Recording happens in `DeviceManager` where `updateDeviceDataValue` runs, so it sees exactly the
arrivals that move `last_updated`, whatever integration produced them.

## Budget resolution — `src/shared/reading-freshness.ts`

```ts
export const CADENCE_MULTIPLIER = 2.5;
export const BUDGET_FLOOR_MS = 2 * 60 * 1000; // = SUBMETER_FRESHNESS_MS today
export const BUDGET_CEILING_MS = 30 * 60 * 1000;
export const BUDGET_LEARNING_MS = 10 * 60 * 1000; // = SUBMETER_FRESHNESS_SLOW_MS today

export function resolveFreshnessBudget(cadence: {
  observedMs?: number | null;
  declaredMs?: number | null;
}): number;
```

Observed wins over declared: a plugin polling every 300 s whose upstream API only refreshes hourly is
described by its arrivals, not by its timer. Neither known: `BUDGET_LEARNING_MS`.

`2.5` rather than `2`: a poll timer plus an HTTP round trip plus the engine's own write drift puts a
"300 s" source at 305-320 s routinely, and at exactly 2x a healthy source sits on the boundary and
oscillates. That is the failure #881 reported, one factor smaller.

Deleted in the same pass:

- `powerBudgetFor()` — every caller now reads the payload field.
- The `demand_5min` entry of `LIVE_POWER_ALIASES` and the branch keyed on it (no plugin has ever
  produced that alias).
- The `solar_panel` branch: a Tasmota bridge at 300 s earns 12.5 min from its cadence.

`SUBMETER_FRESHNESS_MS` and `SUBMETER_FRESHNESS_SLOW_MS` stay as the floor and the learning value, so
nothing about the spec 116 windows moves.

## Wiring

`EquipmentManager.getDataBindingsWithValues` already annotates `stale` per binding (spec 116). The
budget is annotated in the same loop, by `resolvePowerBudget`, from the two dependencies the manager
is already constructed with: `DeviceManager` (which owns the tracker, since arrivals land there) and
`IntegrationRegistry` (`getById(device.integrationId)?.getPollingInfo?.()`).

The first draft of this document routed that through an injected `FreshnessBudgetProvider` built in
`src/index.ts`. It was dropped on contact with the code: the manager holds both dependencies
already, so the interface would have added a seam to inject what is in hand, and one more
construction path able to silently produce budget-less bindings. The declared cadence is only looked
up when nothing was observed, and the device lookup is cached across the bindings of one equipment,
so the common path costs a map lookup.

A binding whose device row has vanished, or whose plugin exposes no `getPollingInfo`, resolves to
`BUDGET_LEARNING_MS`. So does an absent field on the payload, for a consumer parsing an older
response: that is today's banner behaviour.

Only power-category bindings get a budget: it is the only reading the four surfaces judge, and
annotating the rest would invite someone to wire it into spec 116, which this spec explicitly does
not do.

## Types — `src/shared/types.ts`

```ts
export interface DataBindingWithValue extends DataBinding {
  // ...
  /**
   * Freshness budget for this reading, derived from the source's own cadence
   * (spec 175). Present on power bindings only. Absent means "not resolved
   * here": consumers fall back to the learning window.
   */
  freshnessBudgetMs?: number;
}
```

Additive and optional: an existing client keeps the payload it parses today, the same choice #832
made for `powerReadingCurrent`.

## Files touched

| File                                           | Change                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/devices/reading-cadence.ts`               | new — the tracker                                                                      |
| `src/devices/reading-cadence.test.ts`          | new                                                                                    |
| `src/devices/device-manager.ts`                | record an arrival on each value write; forget a deleted row                            |
| `src/shared/reading-freshness.ts`              | `resolveFreshnessBudget`; delete `powerBudgetFor`, `demand_5min`, `solar_panel` branch |
| `src/shared/types.ts`                          | `freshnessBudgetMs` on `DataBindingWithValue`                                          |
| `src/equipments/equipment-manager.ts`          | annotate the budget beside `stale` (`resolvePowerBudget`)                              |
| `src/zones/zone-aggregator.ts`                 | use `binding.freshnessBudgetMs`; drop the alias loop's dead entry                      |
| `src/api/routes/equipments.ts`                 | pass the binding budget to the `?role=submeter` classifier                             |
| `ui/src/lib/power-reading.ts`                  | read the payload field instead of `powerBudgetFor`                                     |
| `ui/src/components/energy/live-staleness.ts`   | drop `SILENCE_BUDGET_MS`, read the payload field                                       |
| `ui/src/components/energy/submeter-helpers.ts` | pass the payload field                                                                 |
| `docs/technical/api-reference.md` + `.fr.md`   | the new binding field                                                                  |

No migration, no new endpoint, no new event.

## Why not the alternatives

**Unify on one constant (part 1 of #883 alone).** Any constant is wrong for one of the two families:
2 minutes flags healthy cloud pollers, 10 minutes blinds a 1 Hz meter for ten minutes. It also settles
the #744 trade-off globally when it is a per-source question, and it would have to be undone to do
this.

**Persist the cadence in `device_data`.** Survives a restart, at the price of a migration and a write
on the hottest path in the engine. The grace window covers the same gap for free, and a restart is
rare next to an arrival.

**Compute the budget in the UI from `lastUpdated` history.** The UI sees one snapshot per push, not
the arrival series, and it would put the rule back on the surfaces, which is the defect.

**Ask the plugin for a per-channel cadence.** The right long answer, and a plugin-API change every
plugin author would have to follow. `getPollingInfo` already exists and covers the polled half; the
observed median covers the streaming half without touching the contract.
