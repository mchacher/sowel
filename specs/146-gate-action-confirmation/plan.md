# Spec 146 — Implementation plan

Branch: `feat/issue-320-gate-action-confirmation`

## Tasks

### Backend

- [x] 1. `types.ts`: add `requireConfirmation?: boolean` to `Equipment`.
- [x] 2. Migration `018_equipment_require_confirmation.sql`:
     `ALTER TABLE equipments ADD COLUMN require_confirmation INTEGER NOT NULL DEFAULT 0`.
- [x] 3. `equipment-manager.ts`:
     - `UpdateEquipmentInput.requireConfirmation?: boolean`
     - `EquipmentRow.require_confirmation: number`
     - `rowToEquipment`: `requireConfirmation: row.require_confirmation === 1`
     - `updateEquipment` prepared stmt: `require_confirmation = @requireConfirmation`
     - update method: resolve `@requireConfirmation` from input or existing row
- [x] 4. `api/routes/equipments.ts`: add `requireConfirmation: { type: "boolean" }`
     to `updateEquipmentBodySchema`; pass it through the PUT handler to
     `equipmentManager.update`.

### Frontend

- [x] 5. `ui/src/types.ts`: mirror `requireConfirmation?` if the UI `Equipment`
     type is declared separately from the shared one.
- [x] 6. `gate-confirm.ts`: pure `gateNeedsConfirm(equipment)` helper.
- [x] 7. `GateConfirmationPanel.tsx`: toggle card (mirror `EnergyManagementPanel`),
     persists via `updateEquipment`.
- [x] 8. `EquipmentDetailPage.tsx`: mount the panel gated on `isGate && isAdmin`.
- [x] 9. `SlideToConfirm.tsx`: drag-to-confirm control (pointer + touch), tokens.
- [x] 10. `ConfirmActionSheet.tsx`: minimal bottom sheet using the control.
- [x] 11. `WidgetGrid.tsx`: `confirmWidgetId` state, render the sheet, extend
      `getMobileClickAction` with the confirm branch via `gateNeedsConfirm`.
- [x] 12. `MobileWidgetCard.tsx`: tiny muted shield when `gateNeedsConfirm`.
- [x] 13. i18n EN + FR keys.

### Tests

- [x] 14. `equipment-manager.test.ts`: persistence round-trip scenarios.
- [x] 15. `gate-confirm.test.ts`: guard-decision scenarios.

### Docs / release

- [ ] 16. `sowel-docs`: note the option on the equipments/dashboard user page.
- [ ] 17. Release notes entry (EN + FR) at release time (spec 108).

## Test Plan

### Modules to test

- `equipment-manager` (backend persistence + mapping of the new boolean).
- `gate-confirm` (pure UI decision helper — the guard gate).

We do not add React component tests (project convention). The slide gesture and
sheet are validated manually on a mobile viewport.

### Scenarios

| Module            | Scenario                                    | Expected                                                           |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| equipment-manager | Update sets `requireConfirmation: true`     | reloaded equipment has `requireConfirmation === true`; column = 1  |
| equipment-manager | Update sets `requireConfirmation: false`    | reloaded equipment has `requireConfirmation === false`; column = 0 |
| equipment-manager | Update omits `requireConfirmation`          | existing value preserved (not reset)                               |
| equipment-manager | Pre-migration / default row                 | `requireConfirmation === false` (column default 0)                 |
| equipment-manager | Unrelated update (e.g. rename) with flag on | flag stays true after the rename update                            |
| gate-confirm      | gate, flag on, single command               | `true`                                                             |
| gate-confirm      | gate, flag on, multi-enum command           | `false` (multi-action not guarded in v1)                           |
| gate-confirm      | gate, flag off                              | `false`                                                            |
| gate-confirm      | gate, flag on, no command binding           | `false`                                                            |
| gate-confirm      | non-gate type, flag on                      | `false`                                                            |

### Manual verification (mobile viewport)

- Toggle on from the gate detail page → shield appears on the dashboard tile.
- Tap guarded tile → sheet slides up; no actuation.
- Complete slide → gate command fires once; sheet closes; state pill flips.
- Partial slide / "Annuler" / scrim tap → no actuation.
- Toggle off → tile taps actuate directly again; shield gone.
- Desktop dashboard and detail-page GateControl unchanged.
