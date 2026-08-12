# Spec 138 — Architecture

## Component

No new module. The feature adds one read-only helper to the recipe runtime and
factors the schedule-interpretation logic out of `TariffClassifier`. The
instance already owns the HP/HC schedule (Settings → Administration → Energy
tariff, stored in settings under `energy.tariff`); spec 138 hands recipes a copy
of it, on the same pattern as `getSunlight()` (spec 126).

```
Settings (energy.tariff, owned by the admin page)
  → TariffClassifier.getConfig()  (cached parse, by reference)
    → RecipeManager.buildTariffSnapshot()  (copies out by value, drops prices)
      → ctx.helpers.getTariff() : RecipeTariff  (fresh object per call)
```

`slotRanges()` / `isWithinSlot()` are exported from `tariff-classifier.ts` and
used by both `classify()` (energy split at write time) and
`buildTariffSnapshot()` (recipe-facing `isOffPeakNow`), so the two schedule
conventions have one definition instead of being re-derived per caller.

## Data model

### Types (`src/shared/types.ts`)

```ts
export interface RecipeTariff {
  configured: boolean;
  offPeakToday: TariffSlot[]; // { start, end, tariff: "hc" }
  isOffPeakNow: boolean | null;
}
```

`getTariff(): RecipeTariff` is added to `RecipeHelpers`, next to `getSunlight`.

The existing tariff types are reused unchanged: `TariffSlot` (`start`, `end` as
`"HH:MM"`, `tariff: "hp" | "hc"`), `DaySchedule` (`days: number[]` with
`0=Sunday..6=Saturday`, `slots`), and `TariffConfig` (`schedules`, `prices`).
`TariffPrices` exists on `TariffConfig` but is deliberately never read into the
snapshot (see Security).

`offPeakToday` holds only the `hc` slots of the schedule covering the current
local day-of-week. A slot whose `end` is not after its `start` wraps past
midnight (`22:00 → 06:00`), and an `end` of `"00:00"` reads as `24:00`, the same
conventions energy classification applies.

## Flow

### Schedule interpretation, extracted (`src/energy/tariff-classifier.ts`)

Two pure functions, exported so both callers share them:

```ts
export function slotRanges(slot: TariffSlot): Array<[number, number]>;
export function isWithinSlot(minuteOfDay: number, slot: TariffSlot): boolean;
```

`slotRanges` expands a slot into concrete `[startMinute, endMinute)` ranges,
applying the two conventions: an `end` of `"00:00"` becomes `1440` (24:00), and a
slot whose `end` is not after its `start` yields two ranges (`[start, 1440]` and
`[0, end]`). `isWithinSlot` tests a minute-of-day against those ranges (start
inclusive, end exclusive). `classify()` now iterates `slotRanges(slot)` instead
of inlining the wrap arithmetic; behaviour is unchanged, which the new
`tariff-classifier.test.ts` pins.

### Snapshot build (`src/recipes/engine/recipe-manager.ts`)

`RecipeManager` gains a `tariffClassifier: TariffClassifier | null` constructor
dependency, wired in `src/index.ts` from
`historyWriter.getTariffClassifier()` (a new accessor on `HistoryWriter`, which
already owns the single classifier instance). Null is a valid value: when the
energy stack is unavailable, recipes see `configured: false`.

`buildTariffSnapshot()` runs on every `getTariff()` call:

1. Read `tariffClassifier?.getConfig()` inside a try/catch. A missing classifier,
   a `null` config (nothing configured, or unparseable settings JSON where the
   classifier already logged and returned `null`), or a throw all return the
   empty snapshot `{ configured: false, offPeakToday: [], isOffPeakNow: null }`.
2. Find the `DaySchedule` covering `now.getDay()`. Keep only its `hc` slots and
   copy each out by value (`{ start, end, tariff }`).
3. Compute `isOffPeakNow` as `offPeakToday.some((s) => isWithinSlot(minuteOfDay, s))`
   where `minuteOfDay = now.getHours() * 60 + now.getMinutes()`.

`getTariff` is registered lazily as an arrow (`() => this.buildTariffSnapshot()`)
on the shared helpers object, so the classifier is read at recipe runtime, not at
construction.

## Key decisions

- **Read-only, no event.** The tariff is owned by the settings page; there is no
  setter and no write path. No `tariff.changed` event is emitted: a recipe
  re-reads the snapshot on its own cadence. An event can follow later if a recipe
  needs to re-arm timers the instant the schedule changes.
- **Today only.** `offPeakToday` covers the current day-of-week, which is what a
  same-night load placement needs. Tomorrow's schedule is out of scope.
- **One schedule interpretation.** `slotRanges` / `isWithinSlot` are the single
  source of truth for the `"00:00" = 24:00` and midnight-wrap conventions, shared
  by energy classification and the recipe snapshot.
- **Never breaks a recipe.** Every failure mode (no classifier, no config,
  unparseable JSON, classifier throw, a day with no schedule) collapses to the
  same empty snapshot, so a recipe can always fall back to its own parameters.

## Security

A recipe package is third-party code running in-process that can republish
anything it is handed (instance state goes out over the WebSocket; MQTT and
notification publishers reach further still). Two properties are deliberate:

1. **No mutation path.** `TariffClassifier.getConfig()` returns its cached object
   by reference; handing that straight to a package would let it rewrite the
   schedule energy billing runs on. `buildTariffSnapshot()` copies every field
   out by value and builds a fresh object per call, so mutating the returned
   snapshot cannot corrupt the stored config, and there is no setter.
2. **Prices are withheld.** Knowing _when_ energy is cheap is enough to schedule a
   load; what it costs is commercial data with no bearing on the decision.
   `config.prices` is never copied into `RecipeTariff` and never leaves the
   manager.

Recorded for context (unchanged by this spec): `GET
/api/v1/settings/energy/tariff` requires authentication but not the admin role
at the time of this spec. Aligning that with `GET /api/v1/settings` (which does
check admin) was a separate follow-up.

## Files changed

| File                                        | Change                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `src/shared/types.ts`                       | `RecipeTariff` type, `getTariff()` on `RecipeHelpers`                    |
| `src/energy/tariff-classifier.ts`           | export `slotRanges` / `isWithinSlot`, route `classify` through them      |
| `src/energy/tariff-classifier.test.ts`      | new tests for the extracted functions and `classify`                     |
| `src/recipes/engine/recipe-manager.ts`      | `tariffClassifier` dependency, `buildTariffSnapshot`, `getTariff` helper |
| `src/recipes/engine/recipe-manager.test.ts` | `getTariff` snapshot tests                                               |
| `src/index.ts`                              | pass `historyWriter.getTariffClassifier()` to `RecipeManager`            |
| `src/history/history-writer.ts`             | `getTariffClassifier()` accessor                                         |
| `docs/technical/recipe-development.md`      | document `getTariff()`                                                   |
| `docs/specs-index.md`                       | spec 138 row                                                             |
