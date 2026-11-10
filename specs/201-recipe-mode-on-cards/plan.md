# Implementation Plan — Spec 201

## Slices

### Slice A — Contract

- [x] A.1 — `RecipeActionDef.targets` in `src/shared/types.ts` and `ui/src/types.ts`

### Slice B — Card pill (core PR)

- [x] B.1 — `ui/src/lib/recipe-target-modes.ts` and its tests
- [x] B.2 — `ui/src/lib/recipe-mode-colors.ts`, zone page switched to it
- [x] B.3 — `CardModePills` and its tests
- [x] B.4 — Mounted in `WidgetCard` and `MobileWidgetCard`
- [x] B.5 — Docs EN and FR (dashboard, recipe development, data model)
- [x] B.6 — FR6: interactive pill on the computer card and in the phone panel (`BottomSheet.aside`)

### Slice C — Recipes (after the core PR is merged)

- [x] C.1 — presence-thermostat: `targets: ["thermostat"]`, test, v1.1.0 (PR mchacher/sowel-recipe-presence-thermostat#3; tag pending)
- [x] C.2 — smart-socket-heating: `targets: ["heaters"]`, test, v0.5.0 (PR mchacher/sowel-recipe-smart-socket-heating#13; tag pending)
- [ ] C.3 — Registry bump PR (`backfill-registry-sha256.mjs`, `check-registry-bump.sh`)

## Test Plan

| Module               | Scenario                                                    | Expected                                                |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| recipe-target-modes  | Single target slot holds the equipment, state among options | One entry with that option                              |
| recipe-target-modes  | List target slot contains the equipment                     | One entry                                               |
| recipe-target-modes  | Equipment only in a non-target slot (cocoon buttons)        | Empty                                                   |
| recipe-target-modes  | Action without `targets`                                    | Empty                                                   |
| recipe-target-modes  | `targets` names a non-equipment or unknown slot             | Ignored, empty                                          |
| recipe-target-modes  | Disabled instance                                           | Empty                                                   |
| recipe-target-modes  | State value absent, or not among the options                | Empty                                                   |
| recipe-target-modes  | Equipment in two target slots of the same instance          | One entry                                               |
| recipe-target-modes  | Two instances target the equipment                          | Two entries, oldest instance first                      |
| recipe-target-modes  | Recipe definition missing (package removed)                 | Empty, no throw                                         |
| CardModePills        | Instance in cocoon targeting the equipment                  | Renders « Cocoon » (recipe i18n label)                  |
| CardModePills        | No matching instance                                        | Renders nothing                                         |
| WidgetCard           | Inside `TileEquipmentContext` with a matching instance      | Pill present, title unchanged                           |
| MobileWidgetCard     | Matching instance                                           | Pill present under label and zone                       |
| CardModePills        | Click on the computer card's pill                           | `sendAction(i1, set_mode, {mode: eco})`, card not fired |
| CardModePills        | Phone card pill; then the phone panel's pill clicked        | Card pill is a span; panel sends the next mode          |
| CardModePills        | Click on the computer card's pill                           | `sendAction(i1, set_mode, {mode: eco})`, card not fired |
| CardModePills        | Phone card pill; then the phone panel's pill clicked        | Card pill is a span; panel sends the next mode          |
| presence-thermostat  | Definition                                                  | `set_mode.targets` is `["thermostat"]`                  |
| smart-socket-heating | Definition                                                  | `set_mode.targets` is `["heaters"]`                     |

The core scenario (cocoon buttons get no pill) is broken once on purpose to see its test fail.

## Validation Plan

- `npm run validate`
- `check-specs-complete`, `check-specs-index folders`, `check-docs-parity`, `check-docs-impact`
- Visual: built UI on `vite preview` proxied to production (read-only), screenshots of the Dashboard on a computer and a phone width, light and dark, with the Poele and Radiateur Bureau cards
