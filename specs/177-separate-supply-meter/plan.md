# Spec 177 — Implementation plan

## Steps (in dependency order)

1. ✅ **Types** — `separateSupply` on `Equipment` (`src/shared/types.ts`,
   `ui/src/types.ts`); `EnergyByUsageResponse.separateSupply?`.
2. ✅ **DB** — `migrations/033_separate_supply.sql`.
3. ✅ **Domain** — `equipment-manager.ts`: row mapping + update path.
4. ✅ **API (equipments)** — PUT schema + FR-4 validations (non-submeter types,
   ineligible parent).
5. ✅ **API (energy)** — by-usage split: partition on non-separate, raw series +
   no cost for the separate group, payload field.
6. ✅ **Tests** — see test plan below.
7. ✅ **UI** — types mirror, `LiveSubmeterBreakdown` group split,
   by-usage view group, `MeteringParentPanel` toggle + eligible-parent filter,
   i18n en/fr.
8. ✅ **Docs** — `docs/technical/api-reference.md` (+ .fr) by-usage payload &
   PUT field; `docs/user/energy.md` (+ .fr) the separate-supply group;
   specs-index rows (en + fr). `data-model.md` does not itemize the
   `equipments` columns (spec 173's column is not there either), so nothing to
   add there.

## Test plan

### Modules to test

- `equipment-manager` (persistence round-trip)
- `api/routes/equipments` (validation)
- `api/routes/energy` (by-usage arithmetic)
- `ui submeter-helpers` / breakdown grouping (pure helpers)

### Scenarios per module

| Module            | Scenario                                                  | Expected                                                                                                                  |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| equipment-manager | Update sets `separateSupply: true`, then clears it        | Persisted, read back as boolean; other fields untouched                                                                   |
| equipment-manager | Update omitting the field                                 | Existing value preserved (undefined-preserves convention)                                                                 |
| equipments route  | Flag on `main_energy_meter` / production types            | 400, nothing persisted                                                                                                    |
| equipments route  | `meteringParentId` naming a separate-supply meter         | 400 (extends spec 173 FR-5)                                                                                               |
| equipments route  | Flag on an equipment already carrying children / a parent | 200; declarations kept (FR-5)                                                                                             |
| energy by-usage   | One separate-supply meter among normal submeters          | Out of `submeters`, Σ and `other` identical to the no-meter baseline; present in `separateSupply` with raw series, cost 0 |
| energy by-usage   | Separate-supply meter with a containment child            | Child renders whole (raw), no subtraction, no error                                                                       |
| energy by-usage   | All meters separate-supply                                | `submeters` empty, `other = main`, group carries all                                                                      |
| energy by-usage   | No main meter configured                                  | Fallback total = Σ non-separate submeters only                                                                            |
| energy by-usage   | Flag absent everywhere (retro-compat)                     | Payload byte-identical to today (no `separateSupply` key)                                                                 |
| ui helpers        | Row grouping                                              | Separate rows out of donut/residual math, listed in own group; freshness verdicts unchanged                               |

### Retro-compat

- Existing installations: column defaults to 0, payloads unchanged, both
  surfaces render identically — covered by the "flag absent" scenarios.

## Gate 4 checks

- `npx tsc --noEmit`, `cd ui && npx tsc -b --noEmit`
- `npx vitest run`
- `npx eslint src/ --ext .ts`
- `bash scripts/check-docs-parity.sh && bash scripts/check-docs-impact.sh && bash scripts/check-specs-index.sh folders`
