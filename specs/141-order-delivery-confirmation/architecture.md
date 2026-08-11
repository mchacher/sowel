# Spec 141: Architecture

## New module

`src/equipments/order-confirmation-tracker.ts`: `OrderConfirmationTracker`, instantiated in `index.ts` next to the other equipment trackers, skipped in shadow mode (no orders are dispatched there anyway). It takes the `IntegrationRegistry` to read `getPollingInfo()` from the integrations behind an order: the watchdog delay is `max(30 s, 2 x poll interval)` so polling integrations (whose mirror binding cannot move before the next poll) do not false-alarm.

Event-driven, no polling, no persistence:

```
equipment.order.executed ──> arm/replace pending entry (map keyed equipmentId:alias)
equipment.data.changed  ──> confirm pending entry when the value matches
device.status_changed   ──> online: re-dispatch eligible unconfirmed entries once
```

## Pending entry

```ts
interface PendingOrder {
  equipmentId: string;
  alias: string;
  value: unknown; // ordered value as emitted by executeOrder
  orderedAt: number; // epoch ms
  timer: NodeJS.Timeout | null;
  unconfirmed: boolean; // timeout elapsed or device_offline fast path
  alarmRaised: boolean;
  retried: boolean; // one reconnect re-dispatch max
  deviceIds: string[]; // devices behind the order bindings, for reconnect matching
  source?: OrderSource;
}
```

Entries are dropped on confirmation or supersession. The map is bounded by the number of distinct `(equipment, alias)` pairs that ever receive orders, so no periodic pruning is needed.

## Value comparison

`valuesMatch(ordered, actual)` normalizes both sides: boolean-like strings (`on`/`off`/`true`/`false`, case-insensitive) map to booleans, numeric strings map to numbers, other strings compare lowercased. Confirmability additionally requires the ordered value to be boolean-like, numeric, or a member of the mirror binding's `enumValues` (case-insensitive), which excludes cross-vocabulary enums (cover `CLOSE` vs `CLOSED`) instead of generating false alarms on them.

## Retry loop protection

The reconnect re-dispatch calls `equipmentManager.executeOrder(..., { kind: "external", channel: "delivery-retry" })`. That dispatch emits `equipment.order.executed` again; the tracker recognizes its own retry channel and only re-arms the confirmation timer on the existing entry (keeping `retried: true`) instead of creating a fresh entry, so exactly one retry can ever happen per pending order.

## Event bus addition

One new member in the `EngineEvent` union:

```ts
| {
    type: "equipment.order.unconfirmed";
    equipmentId: string;
    orderAlias: string;
    value: unknown;
    reason: "timeout" | "device_offline";
    source?: OrderSource;
  }
```

Consumers today: none required (alarms carry the user-facing path); the event exists so the activity feed, WebSocket, or spec 140 can hook it without another schema change.

## Alarm contract

- raise: `system.alarm.raised { alarmId: "order-unconfirmed:<equipmentId>:<alias>", level: "warning", source: "order-confirmation", message }`
- resolve: same `alarmId` on late confirmation or supersession

`notification-publish-service` already forwards both to every configured channel; no changes there.

## Files touched

| File                                                | Change                                              |
| --------------------------------------------------- | --------------------------------------------------- |
| `src/equipments/order-confirmation-tracker.ts`      | new                                                 |
| `src/equipments/order-confirmation-tracker.test.ts` | new                                                 |
| `src/shared/types.ts`                               | `equipment.order.unconfirmed` event member          |
| `src/index.ts`                                      | instantiate + destroy the tracker (non-shadow only) |
| `docs/specs-index.md`                               | spec 141 row                                        |

No migration, no API route, no UI change (alarms and notifications reuse existing surfaces).
