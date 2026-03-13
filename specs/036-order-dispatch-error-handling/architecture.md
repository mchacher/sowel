# Architecture: Order Dispatch Error Handling & System Alarms

## Overview

Three layers: (1) async `executeOrder` with retry in equipment-manager, (2) system alarm events on the event bus, (3) notification + UI presentation.

## Event Flow

```
executeOrder() called
  → await integration.executeOrder() — attempt 1
    → if fails: wait 2s, retry — attempt 2
      → if still fails:
        → emit system.alarm.raised (first failure per integration only)
        → emit equipment.order.failed
        → return { success: false, error }
      → if succeeds after previous failure:
        → emit system.alarm.resolved
        → emit equipment.order.executed
        → return { success: true }

system.alarm.raised
  → notification-publish-service → Telegram message "Warning: source : message"
  → WebSocket → UI clients → useWebSocket store → AlarmBanner visible

system.alarm.resolved
  → notification-publish-service → Telegram message "OK: source : message"
  → WebSocket → UI clients → useWebSocket store → AlarmBanner hidden (if no more alarms)
```

## Data Model Changes

### New event types in `EngineEvent` union (types.ts)

```typescript
| { type: "equipment.order.failed"; equipmentId: string; orderAlias: string; value: unknown; error: string }
| { type: "system.alarm.raised"; alarmId: string; level: "warning" | "error"; source: string; message: string }
| { type: "system.alarm.resolved"; alarmId: string; source: string; message: string }
```

### No new SQLite tables

Alarm state is in-memory only (`failedIntegrations: Set<string>` in EquipmentManager). Alarms are transient — they exist only while the error persists.

## Backend Changes

### `src/equipments/equipment-manager.ts` — Core change

- `executeOrder()` signature: `async executeOrder(...): Promise<{ success: boolean; error?: string }>`
- Added `private failedIntegrations = new Set<string>()` for tracking which integrations are in error state
- Retry loop: 2 attempts, 2s delay between
- On dispatched success: check if integration was in `failedIntegrations` → emit `system.alarm.resolved`
- On all attempts failed: check if integration NOT in `failedIntegrations` → emit `system.alarm.raised`
- Alarm ID format: `order-fail:{integrationId}` (stable per integration, prevents duplicate alarms)
- `executeZoneOrder()` also made async

### `src/integrations/mcz-maestro/mcz-bridge.ts` — Socket health check

Added `!this.socket.connected` to guards in `sendCommand()` and `getStatus()`. Detects race condition where bridge's `this.connected` flag is still true but the underlying Socket.IO connection has dropped.

### `src/notifications/notification-publish-service.ts` — Telegram on alarm

Added two cases in `subscribeToEvents` switch:

- `system.alarm.raised` → `sendSystemAlarm("Warning: {source} : {message}")`
- `system.alarm.resolved` → `sendSystemAlarm("OK: {source} : {message}")`

`sendSystemAlarm()` finds the first enabled Telegram publisher and sends the message. No publisher configured = silently skipped.

### Caller updates

All callers adapted to the async return type:

| File                                   | Pattern                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `src/recipes/presence-thermostat.ts`   | `.then(r => { if (!r.success) log error })`               |
| `src/recipes/presence-heater.ts`       | Same pattern                                              |
| `src/recipes/engine/light-helpers.ts`  | `.catch(() => {})` (fire-and-forget OK for Zigbee lights) |
| `src/modes/mode-manager.ts`            | `.then(r => { if (!r.success) log warn }).catch(...)`     |
| `src/buttons/button-action-manager.ts` | `.catch(err => log error)`                                |
| `src/api/routes/equipments.ts`         | `await` + return HTTP 502 on failure                      |
| `src/api/routes/zones.ts`              | `await` on `executeZoneOrder`                             |

## Frontend Changes

### WebSocket broadcast

No changes needed — `system.alarm.raised` / `system.alarm.resolved` have the `system` prefix, so `getEventTopic()` already routes them to the `"system"` topic which is always subscribed.

### `ui/src/store/useWebSocket.ts`

- New interface: `SystemAlarm { alarmId, level, source, message }`
- New state: `alarms: Map<string, SystemAlarm>`
- `system.alarm.raised` → add to map
- `system.alarm.resolved` → delete from map
- Cleared on disconnect

### `ui/src/components/layout/AlarmBanner.tsx`

New component, similar to `OfflineBanner.tsx`:

- Subscribes to `useWebSocket` → `alarms`
- If `alarms.size > 0`: red banner with AlertTriangle icon + message
- Single alarm: shows `{source} : {message}`
- Multiple alarms: shows `"{count} alarmes actives"`
- Placed in `AppLayout.tsx` right after `OfflineBanner`

### `ui/src/types.ts`

Added the 3 new event types to the `EngineEvent` union (mirrors backend types.ts).

## File Changes

| File                                                | Change                                         |
| --------------------------------------------------- | ---------------------------------------------- |
| `src/shared/types.ts`                               | Add 3 new event types to EngineEvent           |
| `src/equipments/equipment-manager.ts`               | Async executeOrder with retry + alarm emission |
| `src/equipments/equipment-manager.test.ts`          | Update tests for async signature               |
| `src/integrations/mcz-maestro/mcz-bridge.ts`        | Add socket.connected check                     |
| `src/notifications/notification-publish-service.ts` | Handle system.alarm events → Telegram          |
| `src/recipes/presence-thermostat.ts`                | Update 4 mode setters for async result         |
| `src/recipes/presence-heater.ts`                    | Update 2 mode setters for async result         |
| `src/recipes/engine/light-helpers.ts`               | Add .catch() to 3 executeOrder calls           |
| `src/modes/mode-manager.ts`                         | Update executeAction for async result          |
| `src/buttons/button-action-manager.ts`              | Add .catch() to executeOrder call              |
| `src/api/routes/equipments.ts`                      | Await + HTTP 502 on failure                    |
| `src/api/routes/zones.ts`                           | Await executeZoneOrder                         |
| `ui/src/types.ts`                                   | Add 3 new event types                          |
| `ui/src/store/useWebSocket.ts`                      | Add SystemAlarm interface + alarms Map         |
| `ui/src/components/layout/AlarmBanner.tsx`          | New: persistent alarm banner                   |
| `ui/src/components/layout/AppLayout.tsx`            | Add AlarmBanner after OfflineBanner            |
