# Spec 178 — Implementation plan

## Steps

1. **Types** — `TimedCommand.durationStepsMs`, `TimedAction.stepIndex` /
   `nextDurationMs` (`src/shared/types.ts`, mirrored in `ui/src/types.ts`).
2. **DB** — `migrations/034_timed_action_step.sql`.
3. **Ladder arithmetic** — `validateDurationSteps`, `resolveStep`, `nextStep`
   in `src/shared/timed-command.ts`.
4. **Manager** — the four branches of `arm()`; `arm` returns `TimedAction | null`.
5. **API** — PUT schema + validation + `durationMs` forced to `steps[0]`;
   POST answers the view or `{ disarmed: true }`.
6. **Tests** — below.
7. **UI** — types, ladder configuration panel, both controls naming the next
   press, i18n EN/FR.
8. **Docs** — `docs/user/equipments.md` (+ .fr) the ladder;
   `docs/technical/api-reference.md` (+ .fr) the two contract changes;
   specs-index rows (EN + FR).

## Test plan

### Modules to test

- `shared/timed-command` (pure ladder arithmetic)
- `equipments/timed-action-manager` (the four branches, persistence, restart)
- `api/routes/equipments` (write validation, POST answer shape)

### Scenarios

| Module           | Scenario                                                                 | Expected                                                                           |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| timed-command    | Ladder valid / non-increasing / single entry / 7 entries / out of bounds | `validateDurationSteps` names each broken rule                                     |
| timed-command    | `resolveStep` with the stored index still valid                          | that index                                                                         |
| timed-command    | `resolveStep` after the ladder shrank / lengths changed                  | nearest rung not shorter than the running window; past-the-end when none           |
| timed-command    | `nextStep` on a middle rung / on the top rung                            | next length / null                                                                 |
| manager          | First press, ladder present                                              | action dispatched, `step_index = 0`, deadline = rung 1                             |
| manager          | Second press                                                             | nothing dispatched, deadline = now + rung 2, `step_index = 1`, `armedAt` unchanged |
| manager          | Press past the top rung                                                  | window gone, NOTHING dispatched, equipment untouched                               |
| manager          | Press with no ladder (retro-compat)                                      | today's extend-by-`durationMs`, indefinitely                                       |
| manager          | Restart with a window on rung 2                                          | rung survives; next press gives up                                                 |
| manager          | Ladder cleared under a standing window                                   | next press extends per spec 174 rule 3                                             |
| manager          | Deadline fires on rung 3                                                 | revert dispatched as today                                                         |
| manager          | Hand-revert on rung 2                                                    | disarms (spec 174 rule 2 unchanged)                                                |
| equipments route | PUT a valid ladder                                                       | stored, `durationMs` forced to `steps[0]`                                          |
| equipments route | PUT a broken ladder (each FR-1 rule)                                     | 400, nothing persisted                                                             |
| equipments route | POST that climbs / POST that gives up                                    | view with `stepIndex`+`nextDurationMs` / `{ disarmed: true }`                      |

### Retro-compat

Every scenario above with `durationStepsMs` absent must behave exactly as spec
174 does today — the "no ladder" rows are the pin.

## Gates

`npx tsc --noEmit`, `npm run typecheck:tests`, `cd ui && npx tsc -b --noEmit`,
`npx vitest run` (root and ui), `npx eslint src/ --ext .ts`, `cd ui && npx eslint .`,
`check-docs-parity` / `check-docs-impact` / `check-specs-index folders`.
