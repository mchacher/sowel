# Fix: MCZ Maestro Connection Resilience

## Summary

The MCZ cloud server (app.mcz.it:9000) drops Socket.IO connections via ping timeout every ~10-20 minutes. Socket.IO reconnects successfully in ~5s, but during that window polls fail with "MCZ bridge not connected". Additionally, `emitJoin()` fires twice on every reconnect (both `reconnect` and `connect` events), and the integration has no retry logic if the initial connection fails.

## Acceptance Criteria

- [x] No double `emitJoin()` on reconnection
- [x] `getStatus()` waits for reconnection instead of throwing immediately
- [x] Automatic recovery poll triggered after reconnection
- [x] `scheduleRetry()` with exponential backoff on initial start failure
- [x] No data model, API, or UI changes

## File Changes

| File            | Change                                                                    |
| --------------- | ------------------------------------------------------------------------- |
| `mcz-bridge.ts` | Fix double join, add `waitForConnection()`, expose `onReconnect` callback |
| `mcz-poller.ts` | Listen for reconnection → trigger recovery poll                           |
| `index.ts`      | Add `scheduleRetry()` with exponential backoff                            |
