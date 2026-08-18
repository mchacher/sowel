# Architecture — Spec 153 (VMC equipment)

## Flow diagram

```
UI speed selector (OFF / V1 / V2)
  → POST order { equipmentId, alias: "speed", value: "off"|"v1"|"v2" }
    → EquipmentManager.executeOrder()
        │  type === "vmc" && alias === "speed" ?
        ├─ yes → VmcController.applySpeed(equipment, target)
        │           break-before-make, sequenced:
        │             OFF : low←off ; high←off
        │             V1  : high←off (await) ; low←on
        │             V2  : low←off (await) ; high←on
        │           each step → executeOrder(low|high relay binding)
        │                        → device order binding → integration → relay
        └─ no  → existing verbatim dispatch (unchanged)

Relay state report (state_l1 / state_l2)
  → device.data.updated → equipment.data.changed
    → computed engine derives `speed` = f(low_state, high_state)
      → equipment.data.changed { alias: "speed" } → WS → UI reflects state
```

The `speed` order is a **logical** order: it has no device order binding. The two
relays are the only device-facing orders (`low`, `high`), each a normal on/off
binding dispatched verbatim by the existing path. Only the decomposition of
`speed` into a safe, sequenced pair of relay orders is new — and it is the single
place the exclusive interlock is enforced, so recipes and the API get it for free.

## Components

### New: `src/equipments/vmc-controller.ts`

`applySpeed(equipment, target: "off"|"v1"|"v2")`:

- Resolves the `low` (required) and `high` (optional) order bindings.
- Rejects `v2` when `high` is absent (`VmcHighSpeedUnavailableError`).
- Enforces **break-before-make**: awaits the OFF of the non-target relay before
  issuing the ON of the target relay, so at no instant are both energized.
- Delegates each relay step to `equipmentManager.executeOrder(low|high, value)` —
  no new device-dispatch path, it reuses the verbatim one.
- Returns `{ success, error? }`; a failed step leaves the equipment in the safe
  partial state (target not energized) and is logged.

Pure decision helper (unit-testable without a manager):
`planSpeedTransition(target, hasHigh) → Array<{ relay: "low"|"high"; value: boolean }>`
returns the ordered relay steps (empty/error when `v2` without `high`). This is
where the "never both on" invariant is proven by tests.

### Changed: `src/equipments/equipment-manager.ts`

- `VALID_EQUIPMENT_TYPES` += `"vmc"`.
- `executeOrder()`: when `equipment.type === "vmc"` and `alias === "speed"`,
  delegate to `VmcController.applySpeed`; otherwise unchanged.

### Changed: computed `speed`

Derive a computed data `speed` (`off`/`v1`/`v2`) for `vmc` equipments from the
observed `low`/`high` relay state bindings (fallback: last commanded speed).
Both-on observed → `v2` + `logger.warn`. Emitted as `equipment.data.changed`.

### Changed: `src/shared/binding-candidates.ts`

`case "vmc"` in `computeBindingCandidates`: order candidates `low` (required) and
`high` (optional) from on/off device order keys; for a 2-channel relay
(`state_l1`/`state_l2`) map channel 1 → `low`, channel 2 → `high`. Optional data
candidates `low`/`high` from the matching state keys. Add `"vmc"` to
`CANDIDATE_BASED_TYPES`.

### Changed: `src/shared/constants.ts`

- `WIDGET_FAMILY_TYPES`: add `"vmc"` (new `ventilation` family, mirrored in the 2
  UI copies).
- `defaultEnergyClassFor("vmc")` → `"deferrable"`.
- `defaultEnergyTimingsFor("vmc")` → `{ minOnS: 60, minOffS: 30 }` (anti short-cycle).

### UI

A `VmcEquipmentWidget` + a new `WidgetControl` kind `"segmented"` (OFF/V1/V2) in
the presentation resolver; the detail-page and compact/mobile cards reuse the
same control. `Fan` icon everywhere. Full list in "Files changed".

## Files changed

| Domain      | File                                                                                                           | Change                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Types       | `src/shared/types.ts`                                                                                          | `EquipmentType` += `vmc`; `WidgetFamily` += `ventilation`          |
| Core        | `src/equipments/equipment-manager.ts`                                                                          | `VALID_EQUIPMENT_TYPES` += `vmc`; `executeOrder` delegates `speed` |
| Core        | `src/equipments/vmc-controller.ts`                                                                             | **New** — interlock + break-before-make decomposition              |
| Core        | `src/equipments/computed*.ts`                                                                                  | computed `speed` for `vmc`                                         |
| Bindings    | `src/shared/binding-candidates.ts`                                                                             | `case "vmc"` + `CANDIDATE_BASED_TYPES`                             |
| Const       | `src/shared/constants.ts`                                                                                      | `WIDGET_FAMILY_TYPES`, energy defaults                             |
| UI types    | `ui/src/types.ts`                                                                                              | `EquipmentType` + `WidgetFamily` mirror                            |
| UI icons    | `ui/src/components/dashboard/widget-icons.ts`                                                                  | `vmc → "Fan"`                                                      |
| UI card     | `ui/src/components/equipments/EquipmentCard.tsx`                                                               | `TYPE_ICONS` + `TYPE_LABELS` += `vmc`                              |
| UI state    | `ui/src/components/equipments/useEquipmentState.ts`                                                            | `isVmc`, `speed`                                                   |
| UI widget   | `ui/src/components/dashboard/EquipmentWidget.tsx`                                                              | `VmcEquipmentWidget` (OFF/V1/V2 selector)                          |
| UI present. | `ui/src/components/dashboard/presentation/resolveWidgetPresentation.tsx` + `types.ts`                          | `resolveVmc`; new `segmented` control kind                         |
| UI mobile   | `ui/src/components/dashboard/MobileWidgetCard.tsx` + `mobile-click-action.ts`                                  | `vmc` branch                                                       |
| UI compact  | `ui/src/components/home/CompactEquipmentCard.tsx`                                                              | `TYPE_TINTS` + control                                             |
| UI zone     | `ui/src/components/home/ZoneEquipmentsView.tsx`, `dashboard/ZoneWidget.tsx`, `dashboard/WidgetDetailSheet.tsx` | grouping + 2 `WIDGET_FAMILY_TYPES` copies                          |
| UI form     | `ui/src/components/equipments/EquipmentForm.tsx`                                                               | `EQUIPMENT_TYPE_KEYS` += `vmc`                                     |
| UI bind     | `ui/src/components/equipments/bindingUtils.ts`                                                                 | `RELEVANT_DATA`/`RELEVANT_ORDERS`/`STANDARD_ALIASES` for `vmc`     |
| UI detail   | `ui/src/pages/EquipmentDetailPage.tsx`                                                                         | `vmc` control block                                                |
| UI energy   | `ui/src/lib/energy-profile.ts`                                                                                 | `case "vmc"` defaults                                              |
| i18n        | `ui/src/i18n/locales/en.json` + `fr.json`                                                                      | `equipments.type.vmc`, `controls.vmc.*`                            |
| Docs        | `docs/technical/data-model/equipments.md`                                                                      | document `vmc` + speed order                                       |
| Docs        | `docs/user/equipments.md` + `.fr.md`                                                                           | VMC section                                                        |
| Docs        | `docs/specs-index.md` (+ `.fr.md`), `docs/release-notes.md` (+ `.fr.md`)                                       | spec entry + release note                                          |
