# Spec 138 — Implementation plan

Branch: `feat/recipe-tariff-helper`

## Steps

1. **Extract schedule interpretation** — in `src/energy/tariff-classifier.ts`,
   pull the slot-to-range logic out of `classify()` into exported pure functions
   `slotRanges(slot)` and `isWithinSlot(minuteOfDay, slot)`, carrying the two
   conventions (`"00:00"` end means 24:00; an end not after its start wraps past
   midnight). Route `classify()` through `slotRanges` so its behaviour is
   unchanged.
2. **Types** — add `RecipeTariff` (`configured`, `offPeakToday: TariffSlot[]`,
   `isOffPeakNow: boolean | null`) to `src/shared/types.ts` and `getTariff():
RecipeTariff` to `RecipeHelpers`, next to `getSunlight`.
3. **Accessor** — add `getTariffClassifier()` on `HistoryWriter`, which already
   owns the single `TariffClassifier` instance.
4. **RecipeManager** — accept `tariffClassifier: TariffClassifier | null` in the
   constructor; add `buildTariffSnapshot()` (read config, filter today's `hc`
   slots, copy out by value, compute `isOffPeakNow` via `isWithinSlot`, collapse
   every failure to the empty snapshot); register `getTariff: () =>
this.buildTariffSnapshot()` on the shared helpers object.
5. **Wiring** — in `src/index.ts`, pass `historyWriter.getTariffClassifier()`
   to `RecipeManager`.
6. **Tests** — `tariff-classifier.test.ts` (new) and additions to
   `recipe-manager.test.ts` (see test plan below).
7. **Docs** — `docs/technical/recipe-development.md` documents `getTariff()`;
   `docs/specs-index.md` gets the spec 138 row.

## Test Plan

### Modules to test

- `src/energy/tariff-classifier.ts` — the extracted `slotRanges` / `isWithinSlot`
  functions and that `classify()` is behaviour-preserving after the refactor.
- `src/recipes/engine/recipe-manager.ts` — the `getTariff()` snapshot handed to a
  running instance.

### Scenarios

| Module            | Scenario                                             | Expected                                                      |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| tariff-classifier | ordinary slot                                        | one `[start, end)` range                                      |
| tariff-classifier | slot ending at `"00:00"`                             | range ends at 1440, not empty                                 |
| tariff-classifier | slot wrapping past midnight                          | two ranges (`[start,1440]`, `[0,end]`)                        |
| tariff-classifier | zero-length slot                                     | wraps the whole day                                           |
| tariff-classifier | `isWithinSlot` at start and end                      | start included, end excluded                                  |
| tariff-classifier | `isWithinSlot` across the midnight wrap              | true on both sides                                            |
| tariff-classifier | no tariff configured                                 | `classify` bills everything as HP                             |
| tariff-classifier | unparseable settings value                           | bills everything as HP (classifier logs, returns null)        |
| tariff-classifier | window fully inside the off-peak wrap                | attributed fully to HC                                        |
| tariff-classifier | daytime window                                       | attributed fully to HP                                        |
| tariff-classifier | window straddling a transition                       | prorata split                                                 |
| tariff-classifier | non-default window duration                          | honoured, not assumed 30 min                                  |
| tariff-classifier | day with no schedule / slots covering none of window | falls back to HP                                              |
| recipe-manager    | no schedule set (or classifier null)                 | `{ configured: false, offPeakToday: [], isOffPeakNow: null }` |
| recipe-manager    | schedule configured for today                        | only today's `hc` slots returned; prices absent               |
| recipe-manager    | current time inside a midnight-wrapping slot         | `isOffPeakNow: true`                                          |
| recipe-manager    | mutate the returned snapshot, call again             | stored config intact, next call returns the real schedule     |

### Acceptance criteria mapping

AC1 `getTariff()` callable from a recipe; AC2 unconfigured yields the empty
snapshot; AC3 only today's `hc` slots leak in; AC4 `isOffPeakNow` correct across
a midnight wrap; AC5 mutating the snapshot leaves the config intact; AC6 no price
reachable; AC7 `classify()` unchanged by the `slotRanges` extraction.
