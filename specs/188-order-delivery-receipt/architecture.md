# Spec 188 — Architecture

## Approach

This spec **extends the spec 141 `OrderConfirmationTracker`**; it adds no plugin event and no
integration contract. The previous design's `device.order.receipt` plugin event, its
`ALLOWED_EMIT_TYPES` entry, the `OrderReceiptTracker` and the lora2mqtt plugin change are
**dropped**. Everything the tracker needs is already on the event bus:
`equipment.order.executed`, `equipment.data.changed` and `device.data.updated`.

## Data model

- `src/shared/types.ts`
  - `OrderOutcomeStatus = "pending" | "moving" | "confirmed" | "fault" | "unconfirmed"`.
  - Engine event `equipment.order.outcome { equipmentId, orderAlias, value, status,
expected?: "open" | "close", detail?: string, source? }`.
  - `system.alarm.raised` keeps the optional `messageKey` / `messageParams`.
- `migrations/0NN_shared_access_outcome.sql` (next free number)
  - `ALTER TABLE shared_access_journal ADD COLUMN outcome TEXT;` — NULL = not tracked.
  - `ALTER TABLE shared_access_journal ADD COLUMN outcome_expected TEXT;` — `open` / `close`.
  - Replaces migration 037 `receipt` of the first version (never released).

## Tracker changes (`src/equipments/order-confirmation-tracker.ts`)

`PendingOrder` gains:

```ts
kind: "mirror" | "transition" | "end_state"; // "mirror" = spec 141 as today
expected?: "open" | "close";                 // transition and end_state
lastStatus?: OrderOutcomeStatus;             // to emit on change only
```

```
equipment.order.executed
   │
   ├─ classify(equipment, alias, value)
   │    ├─ gate + "pulse" + state known ─────────▶ transition (15 s from closed / 60 s from open)
   │    ├─ shutter + OPEN|CLOSE + vocabulary seen ▶ end_state (60 s)
   │    └─ otherwise ─────────────────────────────▶ spec 141 path, unchanged
   │
   ├─ transition / end_state: retried = true (O9), emit outcome{pending}, arm window
   │
equipment.data.changed / device.data.updated
   ├─ transition: first flip of `closed` / `state` → confirmed
   ├─ end_state: target or position 0/100 → confirmed; OPENING/CLOSING → moving; FAULT → fault
   └─ spec 141 confirm(), unchanged
window elapsed → unconfirmed → alarm (existing markUnconfirmed, new message key)
```

- **Vocabulary memory (O4)**: `Set<"deviceId:key">` filled from `device.data.updated` when the
  value is one of `CLOSED`, `OPENING`, `CLOSING`, `FAULT` (case-insensitive). Read at dispatch
  together with the mirror's current value. Cleared in `destroy()`.
- **Mirror for `end_state`**: the one spec 141's `resolveMirror` already picks (binding with the
  order alias, else the ordered device's own key — `door` on the coop). Position is read from
  the equipment's `position` binding when there is one.
- **Fault detail**: on `FAULT`, the tracker reads the same device's `why` key if present and
  passes it as `detail`; the UI maps known values (`BOTTOM` → « contact bas », `WIRING` →
  « câblage ») and shows unknown ones raw.
- **`fault` vs. alarm**: `fault` calls `markUnconfirmed` with a new reason `device_fault`, so the
  alarm, its supersession and its resolution are spec 141's code paths.
- **No replay (O9)**: `retried = true` at creation. `handleOrderFailed` does not hold a gate
  pulse (state known or not), a cover order `classify` would track, or any order while a tracked
  one is open on the same key: nothing is replayed, nothing is surfaced, the pending entry is
  left untouched.
- **Exempt supersession (O7)**: an exempt order on a key with a tracked entry keeps a
  `transition` entry (window, timer, alarm); an `end_state` entry still `pending` / `moving`
  and without an alarm ends as `unconfirmed` at once, with no alarm (a STOP).
- **Alarm wording (O6)**: `raiseAlarm` stores the raised wording (key + params) on the entry;
  a tracked entry re-raises the same alarm id when its wording changes (inherited alarm, late
  fault reason). A FAULT's alarm is raised after `FAULT_REASON_SETTLE_MS` (1 s). `message` is
  the English text of the same key. `why = NONE` is no detail.
- **Push language (O6)**: `src/equipments/order-outcome-messages.ts` holds the EN + FR
  `alarms.orderOutcome.*` strings (a test compares them with `ui/src/i18n/locales/*.json`). The
  notification service attaches `localized: { en, fr }` to an `order-confirmation` alarm; the
  Web Push channel picks the subscription owner's `preferences.language` (resolver injected
  from `UserManager`), Telegram keeps the English `message`. The Activity feed keeps
  `messageKey` / `messageParams` for that source only; `scoped-deps` strips both from
  plugin-emitted alarms.

## Files

| File                                                                                               | Change                                                                 |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/shared/types.ts`                                                                              | `OrderOutcomeStatus`, `equipment.order.outcome`                        |
| `src/equipments/order-confirmation-tracker.ts`                                                     | kinds, gate state read, vocabulary memory, outcome emission, no replay |
| `src/shared-access/shared-access-manager.ts`                                                       | journal row id kept per press; `open()` returns outcome; listener      |
| `src/shared-access/shared-access-store.ts`                                                         | `setOutcome(rowId, status)`, `outcome` in press rows                   |
| `src/shared-access/guest-page.ts`                                                                  | follow-up polling, three endings (O8)                                  |
| `src/api/websocket.ts`                                                                             | broadcast `equipment.order.outcome`; alarm i18n keys                   |
| `ui/src/store/`                                                                                    | `lastOutcome` per equipment                                            |
| `ui/src/components/dashboard/EquipmentWidget.tsx`, `MobileWidgetCard.tsx`, timed tile, detail      | status line (O5)                                                       |
| `ui/src/components/shared-access/`                                                                 | outcome next to `opened` journal rows                                  |
| `ui/src/i18n/locales/{en,fr}.json`                                                                 | strings                                                                |
| `docs/user/shared-access{,.fr}.md`, `docs/technical/data-model{,.fr}.md`, `api-reference{,.fr}.md` | documentation                                                          |

What the first version added and this one removes from PR #1088: `src/equipments/order-receipt-tracker.ts`,
the `device.order.receipt` handling in `src/plugins/scoped-deps.ts`, the dispatch recording in
`equipment-manager.ts`, migration 037 `receipt`.

## API

- `POST /p/…/api/open` (guest): response gains `outcome?: "pending"`, `expected?: "open" | "close"`,
  `windowS?` (the core's window for that press: 15 or 60).
- Guest `session.presses[]`: each gains `outcome?`, `expected?`.
- Admin journal endpoint: rows gain `outcome`, `expected`.
- WebSocket: new `equipment.order.outcome` message. No new route.
