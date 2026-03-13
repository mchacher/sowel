# Implementation Plan: Order Dispatch Error Handling & System Alarms

## Iteration 1: Backend — async executeOrder + retry

1. [x] Add `equipment.order.failed`, `system.alarm.raised`, `system.alarm.resolved` event types to `src/shared/types.ts`
2. [x] Make `executeOrder` async with retry (2 attempts, 2s delay) in `equipment-manager.ts`
3. [x] Add `failedIntegrations` Set and alarm emission logic (raise on first failure, resolve on recovery)
4. [x] Return `{ success: boolean; error?: string }` from `executeOrder`
5. [x] MCZ bridge: add `!this.socket.connected` check in `sendCommand()` and `getStatus()`

## Iteration 2: Backend — update all callers

6. [x] `presence-thermostat.ts`: update 4 mode setters (setComfort, setEco, setCocoon, setNight)
7. [x] `presence-heater.ts`: update setComfort and setEco
8. [x] `light-helpers.ts`: add `.catch(() => {})` to all executeOrder calls
9. [x] `mode-manager.ts`: update executeAction with `.then()/.catch()`
10. [x] `button-action-manager.ts`: add `.catch()` to executeOrder call
11. [x] `api/routes/equipments.ts`: `await` + return HTTP 502 on failure
12. [x] `api/routes/zones.ts`: `await` executeZoneOrder

## Iteration 3: Telegram notifications

13. [x] `notification-publish-service.ts`: handle `system.alarm.raised` → send Telegram
14. [x] `notification-publish-service.ts`: handle `system.alarm.resolved` → send Telegram

## Iteration 4: UI alarm banner

15. [x] Add event types to `ui/src/types.ts`
16. [x] Add `SystemAlarm` interface + `alarms: Map` state to `useWebSocket.ts`
17. [x] Handle `system.alarm.raised` / `system.alarm.resolved` in event handler
18. [x] Create `AlarmBanner.tsx` component
19. [x] Integrate `AlarmBanner` in `AppLayout.tsx` after `OfflineBanner`

## Iteration 5: Tests

20. [x] Update `equipment-manager.test.ts` for async executeOrder (await + rejects.toThrow)
21. [x] `npx tsc --noEmit` — zero errors (backend)
22. [x] `cd ui && npx tsc --noEmit` — zero errors (frontend)
23. [x] `npm test` — 454 tests pass

## Testing

- `npx tsc --noEmit` (zero errors)
- `cd ui && npx tsc --noEmit` (zero errors)
- `npm test` (454 tests pass)
- Manual: disconnect MCZ bridge, send order from UI → banner appears, Telegram notification received
- Manual: reconnect → banner disappears, Telegram "resolved" notification received
