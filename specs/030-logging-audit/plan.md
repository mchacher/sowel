# Implementation Plan: Logging Audit

## Iteration 1: Fix existing logs

1. [x] zone-aggregator.ts — debug→trace per-zone, add zone name, add debug chain summary
2. [x] device-manager.ts — fix string interpolation in device summary
3. [x] equipment-manager.ts — add equipment/zone name to order execution logs
4. [x] mode-manager.ts — add equipment name to mode order execution logs
5. [x] recipe-manager.ts — add recipe type/name to instance lifecycle logs
6. [x] mqtt-connector.ts — add broker URL to connection state logs
7. [x] panasonic-poller.ts, mcz-poller.ts — debug→trace for polling messages
8. [x] history-writer.ts — debug→trace for cache refresh
9. [x] mqtt-publish-service.ts — add broker name to error logs
10. [x] Type-check + test

## Iteration 2: Fill functional gaps

11. [x] equipment-manager.ts — add trace log in handleDeviceDataUpdated
12. [x] mqtt-publish-service.ts — add debug summary per event handler
13. [x] auth-service.ts — add login success/failure and token refresh logs
14. [x] recipe execution — ctx.log() now also emits to pino with structured context
15. [x] history-writer.ts — trace logs for every shouldWrite() decision (deadband, throttle, state)
16. [x] button-action-manager.ts — add debug for effect execution
17. [x] backup.ts — add info with row counts on export and restore
18. [x] Type-check + test
19. [x] Commit + PR

## Testing

- `npx tsc --noEmit` (zero errors)
- `npm test` (all pass)
- Manual: check logs at INFO and DEBUG levels reflect actual system activity
