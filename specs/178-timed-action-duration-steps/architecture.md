# Spec 178 — Architecture

## Data model

**Migration `034_timed_action_step.sql`**

```sql
ALTER TABLE timed_actions ADD COLUMN step_index INTEGER NOT NULL DEFAULT 0;
```

Which rung the standing window is on. `0` is what every existing row gets, and
what an unladdered equipment keeps for ever — the column is inert without a
ladder.

**`src/shared/types.ts`** — `TimedCommand` gains:

```ts
/** Spec 178 — the ladder of window lengths, shortest first. Absent = one
 *  length, extended in place (spec 174 rule 3). */
durationStepsMs?: number[];
```

`TimedAction` (the read model) gains `stepIndex` and `nextDurationMs | null`
(null on the top rung: the next press gives up).

## Backend

### `src/shared/timed-command.ts`

Pure ladder arithmetic, next to the eligibility rule that already lives there,
because three callers need the same answers (the manager, the write validation,
and the UI through its own copy of the module's shape):

- `validateDurationSteps(steps, min, max): string[]` — the FR-1 rules, returning
  named errors rather than a boolean.
- `resolveStep(steps, storedIndex, currentDurationMs): number` — FR-6. The
  stored index when it still exists and still matches the length, else the
  nearest rung not shorter than the running window, else past-the-end.
- `nextStep(steps, index): number | null` — the length of the next press, or
  null on the top rung.

### `src/equipments/timed-action-manager.ts`

`arm()` keeps its contract. The ladder is applied in one place, on the
`extending` path (the only place a second press is recognised today):

- not extending → rung 0, dispatch, persist `step_index = 0`;
- extending, ladder absent → today's behaviour, `step_index` untouched;
- extending, ladder present, a next rung exists → `expires_at = now + next`,
  `step_index += 1`, dispatch nothing;
- extending, ladder present, no next rung → `disarm(reason)` and return null.

`arm` therefore returns `TimedAction | null`, `null` meaning FR-4 fired.
`armConfigured` passes the ladder down from `equipment.timedCommand`.

### `src/api/routes/equipments.ts`

- `PUT`: `durationStepsMs` in the `timedCommand` schema; on write, when the
  ladder is present, `durationMs` is forced to `steps[0]` (FR-1 — one truth).
  Validation errors come back as 400 with the offending rule named.
- `POST /timed-action`: answers `200` with the `TimedAction` view (now carrying
  `stepIndex` / `nextDurationMs`), or `200 { "disarmed": true }` when the press
  gave the deadline up (FR-4/FR-5). Not 204: the surface needs to tell "the
  window is gone because you asked" from a failed call.

## UI

- `ui/src/types.ts` mirrors both type changes.
- `TimedCommandPanel.tsx` — configure the ladder: add/remove rungs, minutes
  each, with the FR-1 rules enforced before the save so the 400 is a backstop.
- `TimedEquipmentWidget.tsx` — the button's title names **what the next press
  does**: the next rung's length, or "stop counting" on the top rung. The pill
  reports a press that gave the deadline up, because the window is then gone
  and the resting face ("Run for 15 min") would be a trap over an open gate.
  The cancel button is untouched, and `TimedCommandControl` (the compact row)
  is deliberately out of scope — it has no extend press to walk a ladder with.
- i18n EN/FR for the new labels.

## API contract changes

| Surface                                    | Change                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `PUT /api/v1/equipments/:id`               | `timedCommand.durationStepsMs?: number[]`; new 400s per FR-1                                            |
| `POST /api/v1/equipments/:id/timed-action` | may answer `{ disarmed: true }` (FR-4); the `TimedAction` view carries `stepIndex` and `nextDurationMs` |
| `equipment.timed_action.*` events          | unchanged shapes; the disarm reason names the ladder                                                    |
