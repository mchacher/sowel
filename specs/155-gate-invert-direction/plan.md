# Implementation Plan — Spec 155 (Invert Direction for Boolean Gate Triggers)

## Steps

1. `equipment-manager.ts`: `resolveOrderValue` gains an `invertDirection` param; boolean-empty branch resolves to `!invertDirection` instead of a hardcoded `true`. `executeOrder` call site passes `equipment.invertDirection && !isDeliveryRetry` (same guard already used for the shutter-family semantic inversion just above it).
2. Tests (backend, `equipment-manager.test.ts`, in the existing "invert direction" describe block): empty gate trigger inverted -> OFF, not inverted -> ON (regression guard), 3 consecutive inverted triggers all resolve to OFF (no state dependency), explicit non-empty value untouched, delivery-retry guard disables the invert on an empty value too.
3. UI: `InvertDirectionPanel.tsx` picks a type-aware i18n key prefix (`equipments.invertDirectionGate.*` for `gate`, existing `equipments.invertDirection.*` otherwise); `EquipmentDetailPage.tsx` mounts it for `isGate` too; new en/fr strings; component tests for both copy variants + that the toggle persists the same way for a gate.
4. Validation: `tsc`/`eslint`/`vitest` both sides.
5. Deploy to dev VM (no new migration this time — pure code change), set `invertDirection: true` on the real `PorteGarageGauche` equipment (after first clearing `gateTriggerMode` if the earlier iteration's column is still lingering from the previous deploy — see below), trigger repeatedly via the Sowel API and confirm the physical door moves on every press, same as the dropped iteration's validation.

## Note on the dev VM's leftover `gate_trigger_mode` column

The dropped `gateTriggerMode` iteration was deployed and validated on the dev VM before Marc's simplification landed, including running migration `025_equipment_gate_trigger_mode.sql`. That migration file no longer exists in this branch (reverted). The column itself is harmless leftover on the VM (SQLite tolerates an extra column no code references) but should be dropped manually for cleanliness before/while redeploying this version, since no migration will do it automatically once the file is gone.

## Test Plan

### Modules to test

- `equipment-manager.ts` — `resolveOrderValue` boolean-empty branch with `invertDirection`, `executeOrder` end-to-end for a `gate`

### Scenarios per module

| Module            | Scenario                                                | Expected                                            |
| ----------------- | ------------------------------------------------------- | --------------------------------------------------- |
| equipment-manager | gate, `invertDirection: true`, empty trigger            | resolves to `false` (`"OFF"`)                       |
| equipment-manager | gate, `invertDirection: false`/unset, empty trigger     | resolves to `true` (`"ON"`) — regression guard      |
| equipment-manager | gate, inverted, 3 consecutive empty triggers            | all 3 resolve to `false`, identically               |
| equipment-manager | gate, inverted, explicit `"ON"` value                   | passes through untouched, not flipped               |
| equipment-manager | gate, inverted, empty value via a delivery-retry source | resolves to `true` (guard disables invert on retry) |

### Test Results

Automated: pending — see commit history on this branch for the actual `npx vitest run` output once the reworked tests are in place.

Real-hardware validation on the dev VM: pending — to redo against this simplified implementation before considering this done, per the commitment made on issue #627.
