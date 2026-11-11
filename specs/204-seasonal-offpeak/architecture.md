# Architecture — Spec 204

## Data model

No migration: the schedule is the JSON setting `energy.tariff`.

```ts
// src/shared/types.ts
export interface TariffSeason {
  /** First day of summer, "MM-DD". */
  from: string;
  /** Last day of summer, "MM-DD". */
  to: string;
  schedules: DaySchedule[];
}

export interface TariffConfig {
  /** All year, or winter when `summer` is set. */
  schedules: DaySchedule[];
  summer?: TariffSeason;
  prices: TariffPrices;
}
```

`SUMMER_DEFAULT = { from: "04-01", to: "10-31" }` lives next to the classifier.

## One reading of the schedule

`src/energy/tariff-classifier.ts`:

```ts
/** The day schedules in force on a local date (spec 204). */
export function schedulesOn(config: TariffConfig, at: Date): DaySchedule[];
/** Whether a local date falls in the stored summer. */
export function isSummer(season: Pick<TariffSeason, "from" | "to">, at: Date): boolean;
```

`MM-DD` strings compare as strings, so `from <= md && md <= to` is the test.

Callers moved onto it:

| Caller                                   | Today                                   | After                                         |
| ---------------------------------------- | --------------------------------------- | --------------------------------------------- |
| `TariffClassifier.classify`              | `config.schedules.find(day)`            | `schedulesOn(config, windowStart).find(day)`  |
| `RecipeManager.buildTariffSnapshot`      | `config.schedules.find(today)`          | `schedulesOn(config, now).find(today)`        |
| `defaultContract` (`pricing.ts`)         | any slot `hc` in `schedules`            | any slot `hc` in `schedules` or `summer`      |

## API

`src/api/routes/energy.ts`, `tariffBodySchema` gains:

```ts
summer: {
  type: "object",
  required: ["schedules"],
  properties: {
    from: { type: "string", pattern: "^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$" },
    to: { type: "string", pattern: "…same…" },
    schedules: daySchedulesSchema, // the existing items schema, shared
  },
},
```

The handler refuses `from > to` (400) and stores `{ schedules, summer?: { from, to, schedules }, prices }`.
`GET` returns `summer` when stored.

## UI

- `ui/src/types.ts`: `TariffSeason`, `TariffConfig.summer?`.
- `ui/src/lib/tariff.ts`: `isSummerOn(season, date)` and `seasonLabel(…)` helpers (pure, tested).
- `ui/src/components/settings/TariffSettings.tsx`: the schedule editor (timeline + slots + add) becomes a
  component `ScheduleEditor` rendered once, or twice under the checkbox; the state holds `winter` and
  `summer` slots; the save sends `summer` only when ticked.
- Strings EN and FR: the checkbox, « Hiver », « Été », the two date lines, « En cours ».

## Files

| File                                              | Change                                          |
| ------------------------------------------------- | ----------------------------------------------- |
| `src/shared/types.ts`                             | `TariffSeason`, `TariffConfig.summer`           |
| `src/energy/tariff-classifier.ts` (+ test)        | `schedulesOn`, `isSummer`, `classify`           |
| `src/recipes/engine/recipe-manager.ts` (+ test)   | snapshot through `schedulesOn`                  |
| `src/energy/pricing.ts` (+ test)                  | `defaultContract` reads summer                  |
| `src/api/routes/energy.ts` (+ test)               | schema, defaults, `from > to`, GET              |
| `ui/src/types.ts`, `ui/src/lib/tariff.ts` (+ test) | types, helpers                                 |
| `ui/src/components/settings/TariffSettings.tsx`   | checkbox, two blocks                            |
| `ui/src/i18n/locales/{en,fr}.json`                | strings                                         |
| docs                                              | see the docs delta in `spec.md`                 |
