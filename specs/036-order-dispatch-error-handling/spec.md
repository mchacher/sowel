# Order Dispatch Error Handling & System Alarms

## Summary

When a cloud integration (MCZ Maestro, Panasonic CC, etc.) is temporarily unavailable, equipment orders sent by recipes, modes, or the UI were silently swallowed. The recipe logged success even though the command never reached the device. This feature makes `executeOrder` async with retry, introduces a system alarm mechanism (event bus + WebSocket + UI banner), and sends Telegram notifications on first failure and recovery.

## Reference

- Incident: 2026-03-13 — presence-thermostat recipe sent `setpoint → 20°C` at 6h for preheat, but MCZ bridge was disconnected. Command failed silently, recipe logged success.
- Root cause: `equipment-manager.ts` called `integration.executeOrder()` as fire-and-forget (`.catch()` that only logged). The "Equipment order executed" log and event bus emission happened immediately without awaiting the async result.

## Acceptance Criteria

- [x] `executeOrder` is async and returns `{ success: boolean; error?: string }`
- [x] Failed dispatch is retried once after 2 seconds before giving up
- [x] On first failure per integration: `system.alarm.raised` event emitted with stable `alarmId`
- [x] On recovery (first success after failure): `system.alarm.resolved` event emitted
- [x] Telegram notification sent on alarm raised and resolved (via first enabled Telegram publisher)
- [x] UI shows a persistent red/amber banner while any system alarm is active
- [x] Banner disappears automatically when all alarms are resolved
- [x] API returns HTTP 502 when an equipment order fails
- [x] All existing callers (recipes, modes, buttons, light-helpers) handle the async result
- [x] MCZ bridge detects socket disconnection via `socket.connected` check
- [x] All tests pass with the new async signature

## Scope

### In Scope

- Generic mechanism: works for any integration, not MCZ-specific
- Retry: 1 retry with 2s delay per order binding dispatch
- System alarm events on event bus (`system.alarm.raised`, `system.alarm.resolved`)
- Telegram notification on first failure + recovery
- Persistent UI alarm banner (similar to OfflineBanner)
- WebSocket broadcast of alarm events to all connected clients
- MCZ bridge socket health check improvement

### Out of Scope

- Order queue / retry queue with persistence (deferred)
- Per-order retry policy configuration (deferred)
- Alarm history / audit log (deferred)
- Alarm acknowledgment UI (deferred)
- Quiet hours for alarm notifications (deferred)
- Multi-channel alarm notifications (only Telegram for now)
- Alarm severity escalation (deferred)

## Edge Cases

- Multiple order bindings on one equipment: each binding is retried independently. If at least one succeeds, the order is considered successful.
- Integration comes back during retry: second attempt succeeds, alarm resolved.
- Multiple equipments fail on same integration: only one alarm raised per integration (stable `alarmId: order-fail:{integrationId}`).
- No Telegram publisher configured: alarm events still emitted (UI banner works), but no Telegram message sent.
- Recipe sends order while integration is down: recipe logs the failure via `.then()` callback instead of showing false success.
