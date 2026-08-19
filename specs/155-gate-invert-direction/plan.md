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

Automated: `npx vitest run` — 97/97 backend test files (1578 tests) and 55/55 UI test files (520 tests) green, `tsc --noEmit` and `eslint` clean on both sides.

Real-hardware validation on the dev VM (2026-08-19): backup taken, deployed via `git archive` + `docker build` + hot-patch (no new npm dependency, no new migration — pure code change). One deployment mistake caught and fixed along the way: `docker cp` of the `migrations/` directory does not delete files absent from the source, so the previous iteration's `025_equipment_gate_trigger_mode.sql` was still present in the container and got silently re-applied on restart (re-adding the now-unused column). Caught via the startup log, fixed by explicitly removing the stale file from the container plus the leftover column and its `_migrations` tracking row, then restarting again to confirm a clean state matching this branch's actual migration set (024 is now the latest, same as before the dropped iteration).

`invertDirection: true` set on the real `PorteGarageGauche` equipment via the API. 3 consecutive `POST /equipments/:id/orders/command` calls, physical door observed each time: all 3 moved the door — same practical result as the dropped dynamic iteration, with far less code. Zero regression on the rest of the instance.
