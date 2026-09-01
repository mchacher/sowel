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

---

# Phase 2 — configuration and the two surfaces

## Data model

One JSON column on `equipments`, the shape `energy_profile` and `solar_profile` already use, so
absence means off and no default has to be invented.

```sql
-- migrations/032_timed_command.sql
ALTER TABLE equipments ADD COLUMN timed_command TEXT;
```

```ts
// src/shared/types.ts
export interface TimedCommand {
  /** Order alias armed by the timed control. */
  alias: string;
  /** Value dispatched now. `null` for a command that carries none (an impulse). */
  value: unknown;
  /** Value dispatched at the deadline. May equal `value` — see FR-9b. */
  revertValue: unknown;
  durationMs: number;
}
// Equipment.timedCommand?: TimedCommand | null
// WidgetConfig.timed?: boolean
```

`timedCommand` is the **configuration**; `timedAction` (phase 1) is the **window currently running**.
Two fields, two questions, and the UI needs both: the first says whether to draw the control, the
second whether it is counting down.

## Eligibility, in one place

```ts
// src/shared/timed-command.ts
isTimedCommandEligible(equipment, alias?) : boolean
```

Asked by the API before arming, by the equipment page before mounting the panel, and by the widget
picker before offering the timed tile. One implementation, three callers: the surfaces cannot come
to disagree about which equipments can be armed, which is the failure #832 documents.

The rule: an order binding on `alias` exists, and a data binding either mirrors that alias or sits
in `TIMED_STATE_CATEGORIES` (`light_state`, `gate_state`, `cover_state`, `lock_state`,
`appliance_state`).

## What changes in the manager

`arm()` drops the `valuesMatch(value, revertValue)` refusal and asks `isTimedCommandEligible`
instead. The bounds check, the extension rule and the dispatch order are untouched.

## API

- `PUT /api/v1/equipments/:id` accepts `timedCommand` (`null` clears it), validated against the
  equipment's own bindings — a configuration naming an order the equipment does not carry is
  refused where it is written, not where it is fired.
- `POST /api/v1/equipments/:id/timed-action` with an empty body reads `timedCommand`. `409` when
  nothing is configured, so the caller is told the difference between "not configured" and "cannot
  be armed".

## UI

| File | Role |
| --- | --- |
| `ui/src/components/equipments/TimedCommandPanel.tsx` | The configuration, in the `GateConfirmationPanel` shape |
| `ui/src/components/equipments/TimedCountdown.tsx` | **The** countdown: progress ring + mono digits, `size` prop for the tile and the row |
| `ui/src/components/dashboard/TimedEquipmentWidget.tsx` | The timed tile: icon, state pill with the remaining time, extend and cancel |
| `ui/src/components/home/CompactEquipmentCard.tsx` | One control added to the existing row |
| `ui/src/components/dashboard/AddWidgetModal.tsx` | Offers the timed variant on an eligible equipment |

`TimedCountdown` ticks on its own (one interval per mounted instance, cleared on unmount) and
derives everything from `timedAction.expiresAt`. It never counts down from a local timer seeded at
mount: the deadline is the engine's, and a viewer whose tab slept must show what the engine still
owes, not what a stale local clock believes.
