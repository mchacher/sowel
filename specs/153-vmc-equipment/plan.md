# Implementation Plan — Spec 153 (VMC equipment)

## Slices

### Slice A — Backend type + interlock (the safety core)

- A.1 — `EquipmentType` += `vmc` (`src/shared/types.ts`); `WidgetFamily` +=
  `ventilation`. Mirror in `ui/src/types.ts`.
- A.2 — `VALID_EQUIPMENT_TYPES` += `vmc` (`equipment-manager.ts`).
- A.3 — `src/equipments/vmc-controller.ts`: `planSpeedTransition(target, hasHigh)`
  (pure) + `applySpeed(equipment, target)` (dispatch, break-before-make).
- A.4 — `executeOrder`: delegate `type === "vmc" && alias === "speed"` to the
  controller; reject `v2` without `high`.
- A.5 — computed `speed` from observed relay state (fallback: last command);
  both-on → `v2` + warn.

### Slice B — Binding candidates + constants

- B.1 — `binding-candidates.ts` `case "vmc"` (`low` required, `high` optional;
  2-channel relay → `low`/`high`); add to `CANDIDATE_BASED_TYPES`.
- B.2 — `constants.ts`: `WIDGET_FAMILY_TYPES`, `defaultEnergyClassFor`,
  `defaultEnergyTimingsFor` for `vmc`.

### Slice C — UI surface

- C.1 — icons/labels/tints/type-picker: `widget-icons.ts`, `EquipmentCard.tsx`,
  `CompactEquipmentCard.tsx`, `EquipmentForm.tsx` (`Fan`).
- C.2 — `useEquipmentState.ts` (`isVmc`, `speed`) + `bindingUtils.ts` aliases.
- C.3 — new `segmented` control kind + `resolveVmc` in the presentation resolver.
- C.4 — `VmcEquipmentWidget` (dashboard), compact/mobile cards, detail-page
  control, zone grouping + the 2 extra `WIDGET_FAMILY_TYPES` copies.
- C.5 — i18n EN/FR (`equipments.type.vmc`, `controls.vmc.off/v1/v2`).

### Slice D — Docs

- D.1 — `docs/technical/data-model/equipments.md` (type + `speed` order + interlock).
- D.2 — `docs/user/equipments.md` + `.fr.md` (VMC section).
- D.3 — `docs/specs-index.md` (+ `.fr.md`); `docs/release-notes.md` (+ `.fr.md`)
  entry (added at release time per spec 108).

## Test Plan

### Modules to test

- `vmc-controller.ts` — the interlock decision + dispatch (highest priority,
  it is the safety logic).
- `equipment-manager.executeOrder` — routing of `speed` to the controller.
- computed `speed` derivation.
- `binding-candidates` — `case "vmc"` candidates.

### Scenarios

| Module                                 | Scenario                           | Expected                                            |
| -------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| vmc-controller (`planSpeedTransition`) | target OFF                         | `[low←off, high←off]`, never both on                |
| vmc-controller                         | target V1 (has high)               | `high←off` **before** `low←on`                      |
| vmc-controller                         | target V2 (has high)               | `low←off` **before** `high←on`                      |
| vmc-controller                         | target V2, no high                 | error / empty plan (rejected)                       |
| vmc-controller                         | any transition                     | invariant: no step leaves both relays on            |
| vmc-controller (`applySpeed`)          | V1→V2                              | two sequenced `executeOrder`, off awaited before on |
| vmc-controller                         | relay OFF step fails               | ON step not issued; safe partial state; logged      |
| equipment-manager                      | `executeOrder(vmc, "speed", "v2")` | delegates to controller                             |
| equipment-manager                      | `executeOrder(vmc, "low", true)`   | verbatim path (unchanged)                           |
| computed speed                         | low on, high off                   | `speed = "v1"`                                      |
| computed speed                         | low off, high on                   | `speed = "v2"`                                      |
| computed speed                         | both on (external)                 | `speed = "v2"` + warn                               |
| computed speed                         | no state feedback                  | falls back to last commanded speed                  |
| binding-candidates                     | 2-channel relay                    | proposes `low` + `high`                             |
| binding-candidates                     | single relay                       | proposes `low`, no `high`                           |

### UI

- Widget/detail render OFF/V1/V2 selector; single-speed → OFF/ON.
- Selecting a speed issues a `speed` order with the right value.
- `locale-completeness.test.ts` green (EN/FR parity).

## Validation Plan

- `npx tsc --noEmit`, `npx eslint src/ --ext .ts`, `npx vitest run`.
- UI: `cd ui && npx tsc -b --noEmit && npx eslint .`.
- Manual: create a `vmc` equipment bound to two relays, drive OFF/V1/V2, confirm
  (via logs / mock) never both relays on; single-relay VMC shows OFF/ON only.

## Commit scopes

`equipments`, `ui`, `docs` (and `core` for shared types/constants).
