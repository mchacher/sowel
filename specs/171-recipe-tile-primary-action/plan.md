# Plan — Spec 171

## Steps

- [x] 1. `RecipeTileDef.confirm` + `confirmParam` in `src/shared/types.ts` and `ui/src/types.ts`.
- [x] 2. Extract `resolveCycle` + `cycleOptionLabel` from `ModeCyclePill`; the pill consumes them.
- [x] 3. New `card-primary-action.ts`; `WidgetCard` consumes it.
- [x] 4. Split `ConfirmActionSheet` into presentational + `GateConfirmSheet`; point `WidgetGrid` at the wrapper.
- [x] 5. `RecipeTile`: primary action, `sending` guard, mobile confirm sheet.
- [x] 5b. `tileNeedsConfirm`: the instance parameter overrules the declaration.
- [x] 6. i18n keys, EN + FR.
- [x] 7. Tests.
- [x] 8. Docs (technical recipe guide + user dashboard page, EN + FR).

## Test Plan

### Modules to test

- `RecipeTile` — the card action and its guards (the whole point of the spec).
- `ModeCyclePill` — unchanged behaviour after the extraction (regression).
- `ConfirmActionSheet` / `GateConfirmSheet` — the gate path still renders what spec 146 built.

### Scenarios

| Module           | Scenario                                             | Expected                                                     |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| RecipeTile       | Click on card body, one control, enabled             | `sendAction(id, "set_mode", { mode: next })` once            |
| RecipeTile       | Click on the pill                                    | Exactly one call — the card does not double-fire             |
| RecipeTile       | Click on card body, two controls declared            | No call                                                      |
| RecipeTile       | Click on card body, no cycle key in state            | No call                                                      |
| RecipeTile       | Click on card body, instance disabled                | No call                                                      |
| RecipeTile       | Click on card body in edit mode                      | No call                                                      |
| RecipeTile       | `confirm` + mobile: tap body                         | Sheet opens, no call yet                                     |
| RecipeTile       | `confirm` + mobile: slide completed                  | One call                                                     |
| RecipeTile       | `confirm` + mobile: sheet dismissed                  | No call                                                      |
| RecipeTile       | `confirm` + desktop: click body                      | One call, no sheet                                           |
| RecipeTile       | `confirmParam` answered `false`, mobile              | One call, no sheet                                           |
| RecipeTile       | `confirmParam` answered `true`, no `confirm`, mobile | Sheet, no call                                               |
| tileNeedsConfirm | Declaration alone, param both ways, unanswered       | Package default, user override, fallback on absent/null/\"\" |
| RecipeTile       | Double click while the first call is in flight       | One call                                                     |
| ModeCyclePill    | Existing pill cases (spec 169)                       | Unchanged — same next value, same label, same null cases     |
| GateConfirmSheet | Guarded gate on mobile (spec 146)                    | Same title, subtitle and slide label as before               |
