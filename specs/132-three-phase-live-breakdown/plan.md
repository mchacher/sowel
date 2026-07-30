# Plan — Spec 132

## Implementation steps

Branch `feat/three-phase-live-breakdown`.

1. Extract `extractPhases()` (and the shared `formatPower` convention) into
   `ui/src/components/energy/phase-helpers.ts`, typed against
   `EquipmentWithDetails`.
2. Write `phase-helpers.test.ts` covering the scenarios below.
3. `PhaseBreakdown.tsx` consumes `phase-helpers.ts`, renders the bars, returns
   `null` under the 2-phase threshold.
4. Wire `<PhaseBreakdown gridEquipments={gridEqs} />` into `LiveEnergyPage.tsx`.
5. Add `energy.live.phases.title` / `energy.live.phases.phase` to
   `fr.json` / `en.json`.
6. `cd ui && npx tsc -b --noEmit` clean.
7. `cd ui && npx vitest run phase-helpers` clean.
8. Manual verification against a real three-phase meter (dev instance): bind
   `power_l1/l2/l3` on a real `main_energy_meter` equipment, confirm the panel
   renders with correct values in the browser.

## Test Plan

### Modules to test

- `phase-helpers.ts` (`extractPhases`) — pure logic, business rule for what
  counts as a displayable phase set.
- `PhaseBreakdown.tsx` — no React tests in this project (per convention);
  covered by `tsc` + manual verification in the running app (step 8 above).

### Scenarios

| Module         | Scenario                                                        | Expected                                   |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| extractPhases   | No equipment has any `power_l{n}` alias                            | `[]`                                        |
| extractPhases   | One equipment, only `power_l1` bound                               | `[{n:1, power}]` (length 1 → caller hides)  |
| extractPhases   | One equipment, `power_l1`/`power_l2`/`power_l3` bound              | 3 entries, sorted by `n`                    |
| extractPhases   | A bound `power_l2` value is `null`                                 | Phase 2 excluded from the result             |
| extractPhases   | Two `main_energy_meter` equipments both expose `power_l1`           | Their `power_l1` values are summed           |
| extractPhases   | Alias `power_l10` (two-digit phase number)                          | Parsed as `n=10` (regex is digit-agnostic)  |
| extractPhases   | Alias that doesn't match `power_l{n}` (e.g. `power`)                | Ignored                                      |
| PhaseBreakdown  | `extractPhases` returns < 2 entries                                | Component renders `null`                    |
| PhaseBreakdown  | `extractPhases` returns 3 entries                                  | 3 rows rendered (manual check)               |

### Retro-compat

- No existing test files reference `power_l{n}` — nothing to keep passing,
  this is purely additive.
- `LiveSubmeterBreakdown` and `/api/v1/energy/by-usage` are untouched by this
  spec; their own existing tests are unaffected.

## Tasks

- [x] P1 `phase-helpers.ts` extracted with `extractPhases`
- [x] P2 `phase-helpers.test.ts` — all scenarios above
- [x] P3 `PhaseBreakdown.tsx` using the helper
- [x] P4 Wired into `LiveEnergyPage.tsx`
- [x] P5 FR/EN i18n added
- [x] P6 `tsc -b --noEmit` clean
- [x] P7 `vitest run` clean
- [x] P8 Manual verification against a real three-phase meter
