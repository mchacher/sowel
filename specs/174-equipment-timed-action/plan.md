# Spec 174 — Implementation plan

## Phase 1 — the engine owns the deadline (this PR)

1. **`migrations/031_timed_actions.sql`** — one row per equipment, cascading on delete.
2. **`src/equipments/timed-action-manager.ts`** — `arm` / `disarm` / `revertNow` / `getFor`, the four rules, rehydrate at `start()`, timers cleared at `stop()`.
3. **`src/shared/types.ts`** — `TimedAction`, `EquipmentWithDetails.timedAction?`, and the four `equipment.timed_action.*` events.
4. **`src/equipments/equipment-manager.ts`** — `registerTimedActionProvider`, and the field on both detail builders.
5. **`src/api/routes/equipments.ts`** — `POST` and `DELETE /api/v1/equipments/:id/timed-action`, with a body schema for the bounds.
6. **`src/index.ts` / `src/api/server.ts`** — construct early, register the provider, start under `runUnlessShadow`, stop on shutdown.
7. **Tests** — `timed-action-manager.test.ts`: one case per acceptance criterion, with a real database (the foreign key is part of the design) and `executeOrder` replaced, because every case here is about _when_ it fires, not about what the order path does with it.
8. **Docs** — `docs/technical/data-model/`, the API reference, and the specs index row.

## Phase 2 — presentation (separate, after spec 149)

The countdown and the "for how long?" control belong to `WidgetPresentation`, once every widget descriptor comes from it ([#325](https://github.com/mchacher/sowel/issues/325), [#855](https://github.com/mchacher/sowel/issues/855)). Until then the payload carries the state and no surface renders it, which is a deliberate hole rather than an oversight.

## Phase 3 — declared command idempotence (separate spec)

`replaySafe` on the order binding, declared by the integration. It turns FR-6 from a safe default into the right answer: retry the reverts that can be retried, refuse the ones that must never be replayed. It changes the plugin contract, which is why it is not folded in here.

## Phase 4 — retire the clocks

Once phases 1–2 are in service, `motion-light` and `state-trigger-light` can hold their delay through this primitive instead of their own timers, and `delivery-gate`'s successor keeps only what the hardware forces on it.

---

# Phase 2 — plan

## Steps

1. `types.ts` — `TimedCommand`, `Equipment.timedCommand`, `WidgetConfig.timed`; mirrored in `ui/src/types.ts`.
2. `migrations/032_timed_command.sql` — one nullable TEXT column.
3. `src/shared/timed-command.ts` — `TIMED_STATE_CATEGORIES`, `isTimedCommandEligible`.
4. `timed-action-manager.ts` — drop the identical-value refusal, ask eligibility instead.
5. `equipment-manager.ts` — persist and read `timed_command`.
6. API — `PUT /equipments/:id` accepts and validates `timedCommand`; empty-body arm reads it.
7. UI — `TimedCountdown`, `TimedCommandPanel`, `TimedEquipmentWidget`, compact-card control, widget picker.
8. i18n EN + FR.
9. Docs — `docs/user/equipments.md` + `.fr.md`, `docs/technical/api-reference.md` + `.fr.md`.

## Test Plan

### Modules to test

- `src/shared/timed-command.ts` — eligibility
- `src/equipments/timed-action-manager.ts` — the amended guard, arming from stored config
- `src/api/routes/equipments.ts` — validation of `timedCommand`, empty-body arm
- `ui/src/components/equipments/TimedCommandPanel.tsx`
- `ui/src/components/equipments/TimedCountdown.tsx`
- `ui/src/components/dashboard/TimedEquipmentWidget.tsx`
- `ui/src/components/home/CompactEquipmentCard.tsx`

### Scenarios

| Module | Scenario | Expected |
| --- | --- | --- |
| timed-command | Gate: `command` order + `gate_state` reading | eligible |
| timed-command | Light: `state` order + `light_state` reading | eligible |
| timed-command | Blind relay: order, no state reading | not eligible |
| timed-command | Reading exists but the order alias does not | not eligible |
| timed-action-manager | Impulse: action value === revert value === null | armed, no longer refused |
| timed-action-manager | Equipment with no state reading | `TimedActionError`, nothing persisted |
| timed-action-manager | Bounds still enforced (9 s, 25 h) | refused |
| equipments route | `PUT` with a `timedCommand` naming an unknown order | 400, named error |
| equipments route | `PUT` with `timedCommand: null` | cleared |
| equipments route | `POST …/timed-action` empty body, configured | arms from the stored values |
| equipments route | `POST …/timed-action` empty body, not configured | 409 |
| TimedCommandPanel | Not eligible | panel not rendered by the page |
| TimedCommandPanel | Enable, fill, save | `updateEquipment` called with the four fields |
| TimedCommandPanel | Disable | `timedCommand: null` |
| TimedCountdown | 10 min 42 s left | renders `10:42`, ring at the right fraction |
| TimedCountdown | Deadline passed while the tab slept | renders `0:00`, no negative time |
| TimedEquipmentWidget | No window | shows the timed control, no countdown |
| TimedEquipmentWidget | Window open | countdown, extend calls arm, cancel calls delete with `revert=true` |
| CompactEquipmentCard | Window open on a gate | countdown badge, cancel control replaces the command |
