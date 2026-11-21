# Spec 213 — Plan

## Slices

### Slice A — State machine and virtual binding

- [ ] `appliance-cycle-tracker.ts`: `nextCycleState`, tracker with timers, tests.
- [ ] Types, migration 046, row mapper and `update()` for `applianceCycle`.
- [ ] `equipment-manager.ts`: FR1 test, virtual binding, power hook, forget paths, tests.
- [ ] `equipments.ts` route: schema and FR3.2 validation.

### Slice B — History

- [ ] HistoryWriter historizes `virtual:appliance_state:*`, test.
- [ ] `/history/bindings` lists it with `virtual` and `enumValues`.
- [ ] `history-utils.ts` cardinality rule, test; no toggle on a virtual row.

### Slice C — Surfaces

- [ ] `ui/src/lib/appliance.ts` `applianceIsOn`, test.
- [ ] `AppliancePanel`, `MobileWidgetCard`: on rule and the `ready` / `finished` labels.
- [ ] `ApplianceCyclePanel` + mount + i18n EN/FR.

### Slice D — Docs

- [ ] Docs delta of the spec, EN and FR.

## Test Plan

### Modules to test

- `src/equipments/appliance-cycle-tracker.ts` (pure function and tracker with fake timers)
- `src/equipments/equipment-manager.ts` (virtual binding injection, power hook)
- `src/api/routes/equipments.ts` (threshold validation, through the existing route tests)
- `src/history/history-writer.ts` (virtual series historized)
- `ui/src/lib/appliance.ts`, `ui/src/components/history/history-utils.ts`

### Scenarios

| Module                  | Scenario                                                              | Expected                                                  |
| ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| appliance-cycle-tracker | `off`, P = 6 W                                                        | `ready`                                                   |
| appliance-cycle-tracker | `ready`, P = 21 W                                                     | `running`                                                 |
| appliance-cycle-tracker | `off`, P = 1900 W (machine switched on mid-heating after a restart)   | `running`                                                 |
| appliance-cycle-tracker | `running`, P = 6 W for 299 s then 90 W                                | stays `running`, timer cancelled, no event                |
| appliance-cycle-tracker | `running`, P = 5 W, no further sample for 300 s                       | `finished` at 300 s, one event                            |
| appliance-cycle-tracker | `finished`, P = 0 W                                                   | `off`                                                     |
| appliance-cycle-tracker | `running`, P = 0 W                                                    | `off`, no `finished`                                      |
| appliance-cycle-tracker | `running`, end delay armed, P = 0 W (switched off at 160 s)           | `finished` then `off`, two events                         |
| appliance-cycle-tracker | `finished`, P = 5 W                                                   | stays `finished`, no event                                |
| appliance-cycle-tracker | Replay of the recorded 2026-11-13 07:28 cycle (fixture from prod)     | `running → finished → off`, finished at the switch-off    |
| appliance-cycle-tracker | Replay of the 2026-11-11 cycle (100 s dip at 14:04 UTC)               | one `running` only                                        |
| appliance-cycle-tracker | Custom thresholds `{ 50, 20, 60 }`, P = 30 W from `ready`             | stays `ready`                                             |
| appliance-cycle-tracker | `reevaluate` with new thresholds while `running` at P = 12 W, endW 15 | delay armed                                               |
| appliance-cycle-tracker | Cold start at P = 5 W                                                 | `ready`, never `finished`                                 |
| appliance-cycle-tracker | `destroy()` with a timer armed                                        | timer cleared, no late event                              |
| equipment-manager       | appliance, numeric `power`, no `state`                                | virtual `state` binding first, four `enumValues`          |
| equipment-manager       | appliance with a bound `state`                                        | no virtual binding, the bound one only                    |
| equipment-manager       | appliance with boolean `power`                                        | no virtual binding                                        |
| equipment-manager       | non-appliance with numeric `power`                                    | no virtual binding                                        |
| equipment-manager       | appliance whose power has no value yet                                | virtual binding with a `null` value                       |
| equipment-manager       | power update on an FR1 appliance                                      | `equipment.data.changed` alias `state` on transition      |
| equipment-manager       | type changed to `switch`                                              | `applianceCycle` cleared, no virtual binding              |
| equipments route        | `endW > startW`, `endDelayS = 10`, `endW = 0.5`                       | 400, field named                                          |
| equipments route        | `applianceCycle` on a `switch`                                        | 400                                                       |
| equipments route        | `applianceCycle: null`                                                | saved, defaults apply                                     |
| history-writer          | `state` change on the virtual appliance binding                       | point written, `value_string` label, `value_number` index |
| history-writer          | gate virtual `state` change                                           | still not written (retro-compat)                          |
| appliance (ui lib)      | `state` = running / off; no state + power true / 6.5 W / 0.4 W        | on / off / on / on / off                                  |
| history-utils           | `appliance_state` with 2 or no `enumValues`                           | `states` family (retro-compat)                            |
| history-utils           | `appliance_state` with 4 `enumValues`                                 | not `states`                                              |

The core scenario (end after the delay, not before) is checked failing once on purpose by
setting the timer to `endDelayS - 1`.

## Validation Plan

- `npm run validate`, then the four docs and spec checks.
- Local backend on a scratch DB (`SQLITE_PATH=<scratch>/sowel.db API_PORT=3141`), an
  `appliance` bound to a fake numeric `power`, driven through the 2026-11-13 fixture: watch the
  `state` events, the panel and the history chart. No browser sweep against production.

## Production deployment

After the release, on the maintainer's go:

1. Leave the SmartThings `state` binding in place until the comparison is done: the derived
   state stays inactive, so nothing changes in production.
2. At the cut (or earlier, on the maintainer's call): remove the SmartThings `state` binding of
   `Lave-linge` (963f8be5…); the derived state takes over.
3. Change the "lessive terminée" `state-watch` instance (6a613540…) watch value from `ready` to
   `finished`.
4. Check the next cycle: one alarm at the end, cleared at the automatic switch-off, and the
   `state` series in the history.
