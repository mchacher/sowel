# Spec 174 — Architecture

## Where it sits

```
POST /equipments/:id/timed-action
        │
        ▼
TimedActionManager.arm()
        │  dispatches the action …
        ├──────────────► EquipmentManager.executeOrder()   (spec 154 inversion,
        │                        │                          spec 150 resolution)
        │                        └──► OrderConfirmationTracker  (spec 141:
        │                                confirmation, alarm, bounded replay)
        │  … and persists what it owes
        └──────────────► timed_actions (one row per equipment)
                                 │
                       setTimeout │ rehydrated at boot
                                 ▼
                         executeOrder(revertValue)
```

The manager owns **one thing**: the deadline. Everything the order path already does is reached through `executeOrder` rather than re-stated — which is the same argument [#744](https://github.com/mchacher/sowel/issues/744) and [#832](https://github.com/mchacher/sowel/issues/832) were both about.

## Data model

`migrations/031_timed_actions.sql`:

| Column         | Type    | Note                                                                                         |
| -------------- | ------- | -------------------------------------------------------------------------------------------- |
| `equipment_id` | TEXT PK | `REFERENCES equipments(id) ON DELETE CASCADE` — FR-2 and the cleanup are the same constraint |
| `alias`        | TEXT    | order alias carrying both the action and its revert                                          |
| `action_value` | TEXT    | JSON                                                                                         |
| `revert_value` | TEXT    | JSON                                                                                         |
| `expires_at`   | INTEGER | epoch ms                                                                                     |
| `armed_at`     | INTEGER | epoch ms — preserved across an extension (FR-5)                                              |
| `armed_by`     | TEXT    | user id when the source is manual, NULL otherwise                                            |

**Why JSON and not a bare TEXT.** An order value is a boolean, an enum string or a number depending on its binding, and `NULL` is a legitimate revert value — a gate's sequential impulse carries none. A JSON envelope keeps `false` and `"false"` distinguishable, which `valuesMatch` then relies on.

**Why epoch ms and not an ISO string.** Every read of this column is an arithmetic one (remaining, expired, ordering). The ISO form is produced at the edge, in `toView()`, because that is what a UI ticks down.

## The manager

`src/equipments/timed-action-manager.ts` — one class, no scheduler abstraction: at most one `setTimeout` per equipment, `unref`'d so a pending deadline never holds the process open at shutdown.

- `start()` rehydrates and subscribes. Called from section 17 of `index.ts` under `runUnlessShadow`, **not** at construction: construction happens early so `registerTimedActionProvider` is in place before any equipment query, and starting it can dispatch (FR-10).
- `arm()` is the only path that dispatches an action, and it dispatches **before** it persists: nothing is owed for an order that could not go out.
- `fire()` drops the row **before** the order goes out. The mirror binding is about to report the revert value, and a row still standing would read the engine's own revert as a hand-revert (FR-4) and log a disarm for something it did itself.
- `onDataChanged()` matches on the **order's own alias**, not on any reading that happens to carry the revert value. That is spec 141's mirror rule, and it has a consequence worth naming: an equipment whose command has no mirror — a gate's sequential impulse, whose state binding cannot say which of the two things the command did — never takes the FR-4 path at all. Such hardware needs a recipe, which is the boundary this spec draws.

## The payload

`EquipmentManager` gains `registerTimedActionProvider`, mirroring `registerComputedDataProvider` — with one deliberate difference: **one** provider, not a list. An equipment has at most one deadline standing; two answers would be a bug, not an aggregation. A provider that throws is swallowed, as computed-data providers are: a timed action must never break an equipment query.

## Events

Four, all on the equipment: `armed` (carrying `extended`, so a consumer can tell a new window from a longer one), `reverted`, `disarmed`, `failed`. The failure additionally raises `system.alarm.raised` under source `timed-action`, which is what reaches the notification pipeline.

`armed` carries `expiresAt` as **epoch ms** while the API carries it as ISO-8601: the bus is machine-to-machine inside one process, the API is a contract with a browser.

## Shutdown

`stop()` clears every timer and unsubscribes. It does **not** fire the pending reverts: a restart is not a reason to close a gate early, and the row is what carries the obligation across (FR-3).
