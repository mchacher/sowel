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
