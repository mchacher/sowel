# Plan — Spec 173

## Steps

- [x] 1. Migration 030 (column + index).
- [x] 2. Types, shared and UI.
- [x] 3. `metering-nesting.ts`: `childrenByParent`, `subtractChildren`, `wouldCycle`.
- [x] 4. Equipment manager: row mapper, update statement, input.
- [x] 5. `PUT /api/v1/equipments/:id`: accept + the four refusals.
- [x] 6. By-usage: subtract before summing, flag the net series.
- [x] 7. UI: `MeteringParentPanel`, mount, legend mention, i18n.
- [x] 8. Tests.
- [x] 9. Docs (EN + FR).

## Test Plan

### Modules to test

- `metering-nesting` — the arithmetic and the cycle guard, pure, no DB.
- `PUT /api/v1/equipments/:id` — the four refusals and the happy path.
- `GET /api/v1/energy/by-usage` — the subtraction reaching the payload and the residual.
- migration 030 — the column lands on a database that already holds equipments.
- `MeteringParentPanel` — what it offers and what it refuses to offer.

### Scenarios

| Module              | Scenario                                         | Expected                                                                |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| metering-nesting    | Parent with one child                            | Parent series reduced bucket by bucket                                  |
| metering-nesting    | Child exceeds parent in a bucket                 | 0, never negative                                                       |
| metering-nesting    | Chain A ⊃ B ⊃ C                                  | A−B, B−C, C — sums back to A                                            |
| metering-nesting    | Two children on one parent                       | Both subtracted                                                         |
| metering-nesting    | No declaration anywhere                          | Series returned untouched                                               |
| metering-nesting    | `wouldCycle` on self / 2-cycle / 3-cycle / clean | true, true, true, false                                                 |
| equipments route    | Set, then clear, a valid parent                  | 200, value persisted then null                                          |
| equipments route    | Unknown parent                                   | 404                                                                     |
| equipments route    | Self, cycle, non-submeter parent                 | 400 with the matching error code                                        |
| by-usage            | Parent + child declared                          | Parent net, child whole, `other` grown, `netOfChildren` flagged         |
| migration 030       | Existing rows                                    | Column added, every equipment keeps its data, parent NULL               |
| MeteringParentPanel | Options offered                                  | Other eligible meters only — no self, no descendant, no main/production |
| MeteringParentPanel | Choosing a parent                                | `updateEquipment` called with the id; "none" sends null                 |
