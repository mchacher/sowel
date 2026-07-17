# Plan — Spec 130

## Implementation steps

### A. Core (this repo) — branch `feat/watering-weekdays`

1. `ZoneRecipesSection.tsx`: add `renderMultiSelectChips(slot, value, onChange, recipe, lang)`.
2. Grouped render path: render `select && list` slots full-width after the compact
   grid; exclude them from the compact-grid filter.
3. Ungrouped render path: `select` branch renders chips when `slot.list`.
4. `cd ui && npx tsc -b --noEmit` clean.

### B. Recipe (`sowel-recipe-auto-watering`) — branch `feat/weekdays`

1. Mirrored types: add `select` to the type union, `options` on `RecipeSlotDef`, and
   `options` on `RecipeSlotI18n`.
2. `WEEKDAY_OPTIONS` + `DAY_TOKEN_TO_DOW` map + `parseDays()`.
3. Add `slot{1,2,3}_days` slots in `buildSlots`; FR/EN i18n incl. option labels.
4. `TimeSlot.days`; populate in `createInstance` from `parseDays(params[slotN_days])`.
5. Rewrite `msUntilTime(time, days, now)` (day-aware, offset scan) and make
   `findNextSlot(slots, now)` use it; thread `days` through `scheduleSlot`.
6. Export helpers for tests.
7. Tests (see plan below); `npm run build` + `npm test` clean.

Order overall: do A (core) and B (recipe) independently; both are needed for the full
UX but each compiles/tests on its own.

## Test Plan

### Modules to test

- `sowel-recipe-auto-watering` `src/index.ts` — the day-aware scheduler
  (`parseDays`, `msUntilTime`, `findNextSlot`) and end-to-end firing on allowed days.
- Core `ZoneRecipesSection.tsx` — no React tests in this project (per convention);
  verified by `tsc` + manual check in the running app against the approved mock.

### Scenarios

| Module                       | Scenario                                                      | Expected                                                                    |
| ---------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| parseDays                    | `"mon,wed,fri"`                                               | `{1,3,5}`                                                                   |
| parseDays                    | array `["sat","sun"]`                                         | `{6,0}`                                                                     |
| parseDays                    | `""` / `undefined` / `[]`                                     | empty set (= every day)                                                     |
| parseDays                    | `"mon,bogus,SUN"` (case/unknown)                              | known tokens only, unknown dropped                                          |
| msUntilTime                  | empty days, time later today                                  | fires **today** at HH:MM (unchanged behavior)                               |
| msUntilTime                  | empty days, time already passed                               | fires **tomorrow** (unchanged behavior)                                     |
| msUntilTime                  | `now`=Wed, days={Mon,Tue,Thu,Fri}, time ahead                 | fires **Thu** (skips Wed)                                                   |
| msUntilTime                  | `now`=Wed 08:00, days={Wed}, time 07:30 (passed)              | fires **next Wed** 07:30                                                    |
| msUntilTime                  | `now`=Sat, days={Wed,Sat,Sun}, time ahead                     | fires **today (Sat)**                                                       |
| msUntilTime                  | all 7 days selected                                           | same as empty (every day)                                                   |
| findNextSlot                 | slot1 07:30 {Mon..Fri}, slot2 09:00 {Sat,Sun}, now=Fri 10:00  | next = slot2 Sat 09:00                                                      |
| createInstance (fake timers) | Romain case: Wed, slot1 07:30 school-days, slot2 09:00 Wed/WE | slot1 does **not** fire Wed; slot2 fires Wed 09:00 → valves open then close |
| createInstance               | slot with empty days                                          | fires daily exactly as before (retro-compat)                                |
| createInstance               | rain skip still applies on an allowed day                     | slot skipped, status `skipped`                                              |
| createInstance               | resume-after-restart                                          | unchanged (existing tests still green)                                      |

### Retro-compat

- All existing `src/index.test.ts` scenarios pass unchanged (empty days path == old
  today/tomorrow path).

## Tasks

- [x] A1 core multi-select chip renderer (grouped + ungrouped)
- [x] A2 core `tsc -b --noEmit` clean
- [x] B1 recipe mirrored types + `select`
- [x] B2 `parseDays` + weekday map
- [x] B3 `slotN_days` slots + FR/EN i18n
- [x] B4 day-aware `msUntilTime` / `findNextSlot` / `scheduleSlot`
- [x] B5 weekday scheduler tests (all scenarios above)
- [x] B6 recipe `build` + `test` clean; existing tests still green
