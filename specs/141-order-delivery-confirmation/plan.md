# Spec 141 — Implementation plan

Branch: `feat/spec-141-order-delivery-confirmation`

## Steps

1. **Event bus addition** — one new `equipment.order.unconfirmed` member in the
   `EngineEvent` union in `src/shared/types.ts` (`equipmentId`, `orderAlias`,
   `value`, `reason: "timeout" | "device_offline"`, optional `source`). No other
   consumer is required; alarms carry the user-facing path.
2. **Value helpers** — `normalizeValue`, exported `valuesMatch(ordered, actual)`
   and `isConfirmableValue(ordered, enumValues?)` in
   `src/equipments/order-confirmation-tracker.ts`. Boolean-like strings map to
   booleans, numeric strings to numbers, other strings compare lowercased.
   Confirmability additionally requires the ordered value to be boolean-like,
   numeric, or a member of the mirror binding's `enumValues`, which exempts
   cross-vocabulary enums (cover `CLOSE` order vs `CLOSED` state).
3. **Tracker skeleton** — `OrderConfirmationTracker` class taking the
   `EventBus`, `EquipmentManager`, `DeviceManager`, `IntegrationRegistry` and a
   logger. In-memory `pending` map keyed `equipmentId:alias`, `init()` that
   subscribes to the three events, `destroy()` that clears timers and
   unsubscribes. Constants `CONFIRMATION_TIMEOUT_MS = 30_000`,
   `REDISPATCH_TTL_MS = 3_600_000`, exported `RETRY_CHANNEL = "delivery-retry"`.
4. **Watchdog on `equipment.order.executed`** — resolve the mirror data binding
   for the alias; exempt orders with no mirror binding or a non-confirmable
   value. Supersede any pending entry on the same key (resolving its alarm).
   Confirm immediately when the mirror already holds the ordered value. Mark
   `device_offline` at once when every target device is offline, otherwise arm
   the timer.
5. **Poll-aware timeout** — `confirmationTimeoutFor(deviceIds)` stretches the
   delay to `max(30 s, 2 x poll interval)` by reading `getPollingInfo()` from
   the integration behind each device, so polling integrations (Panasonic, MCZ)
   do not false-alarm before their next poll.
6. **Unconfirmed marking** — `markUnconfirmed(entry, reason)` clears the timer,
   emits `equipment.order.unconfirmed`, and raises `system.alarm.raised` once
   with `alarmId order-unconfirmed:<equipmentId>:<alias>`, level `warning`,
   source `order-confirmation`, and a message naming the equipment, ordered
   value, and reason.
7. **Confirmation on `equipment.data.changed`** — when the mirror value matches
   the pending order, clear the timer, resolve the alarm if raised, and drop the
   entry.
8. **Reconnect re-dispatch on `device.status_changed`** — for each unconfirmed,
   not-yet-retried entry bound to the now-online device and younger than the
   TTL, re-dispatch once via `equipmentManager.executeOrder(..., { kind:
"external", channel: RETRY_CHANNEL })` and mark `retried`. The retry's own
   `equipment.order.executed` echo re-arms the existing entry instead of
   creating a new one, so exactly one retry can ever happen.
9. **Tests** — `src/equipments/order-confirmation-tracker.test.ts` (see test
   plan below).
10. **Wiring** — instantiate the tracker in `src/index.ts` next to the other
    equipment trackers, `init()` unless shadow mode, `destroy()` on shutdown.

## Test Plan

### Modules to test

- `src/equipments/order-confirmation-tracker.ts` — value helpers,
  confirmability, watchdog lifecycle, offline fast path, reconnect re-dispatch,
  supersession, poll-aware timeout.

### Scenarios

| Scenario                                                    | Expected                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `valuesMatch` across boolean-like, numeric, string forms    | equivalent wire representations match, mismatches do not           |
| `isConfirmableValue` boolean-like and numeric               | confirmable                                                        |
| `isConfirmableValue` enum member vs cross-vocabulary enum   | member confirmable, `CLOSE`/`STOP` vs `OPEN`/`CLOSED` exempt       |
| state reports the ordered value in time                     | confirmed silently, no unconfirmed event, no alarm                 |
| state already holds the ordered value at order time         | confirmed immediately, no watchdog, no alarm                       |
| no state change before timeout                              | `equipment.order.unconfirmed` (`timeout`) plus one `warning` alarm |
| late `equipment.data.changed` after a raised alarm          | `system.alarm.resolved`                                            |
| every target device offline at order time                   | `unconfirmed` (`device_offline`) and alarm raised immediately      |
| device back online, unconfirmed order younger than the TTL  | re-dispatched exactly once, later confirmation resolves the alarm  |
| second reconnect after the retry                            | no second re-dispatch                                              |
| retry's own `order.executed` echo (RETRY_CHANNEL)           | re-arms the existing entry, still a single alarm                   |
| newer order on the same key while one is pending            | old alarm resolved, new order gets its own watchdog                |
| order with no mirror data binding                           | exempt, no alarm                                                   |
| cross-vocabulary enum order (`CLOSE` vs `OPEN`/`CLOSED`)    | exempt, no alarm                                                   |
| unconfirmed order older than the 1h TTL, device back online | no re-dispatch                                                     |
| polling integration, 60 s interval                          | no alarm before 2 x interval (120 s), alarm fires past it          |
| numeric order confirmed against a numeric-string state      | confirmed, no alarm                                                |
