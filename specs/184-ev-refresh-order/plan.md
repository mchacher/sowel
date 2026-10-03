# Spec 184 — Plan

## Steps

- [x] 1. Types and contract (`ev_refresh`, alias `refresh`).
- [x] 2. UI binding relevance, state helper, control button, i18n.
- [x] 3. Tests (below), docs, specs index rows.
- [ ] 4. Validate, agent review, PR.

## Test plan

| Module                    | Scenario                                             | Expected                    |
| ------------------------- | ---------------------------------------------------- | --------------------------- |
| electric-vehicle-contract | `ev_refresh` maps to `refresh`; it is an order alias | contract table holds        |
| equipment-manager         | API auto-bind of a device with an `ev_refresh` order | order bound as `refresh`    |
| bindingUtils              | UI plan for a vehicle device with `ev_refresh`       | `refresh` in the order plan |
| electricVehicleState      | equipment with / without `refresh` bound             | `refreshAlias` set / null   |
