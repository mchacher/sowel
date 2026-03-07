# Implementation Plan: V0.11 Logging System

## Dependencies

- No dependency on other unimplemented features
- Builds on existing Pino logger infrastructure

## Tasks

### Backend

1. [ ] Install `pino-roll` dependency
2. [ ] Add `LogEntry` and `LogLevel` types to `src/shared/types.ts`
3. [ ] Create `src/core/log-buffer.ts` — LogRingBuffer class
   - Circular buffer with configurable capacity (default 2000)
   - `push(entry)` — O(1) insert
   - `query({ limit, level, module, search, since })` — filtered retrieval
   - `subscribe(listener)` / unsubscribe — for WebSocket streaming
   - `getModules()` — unique module names seen
4. [ ] Rewrite `src/core/logger.ts`
   - `createLogger(level, logBuffer?)` returns pino Logger
   - Production: `pino.multistream` with stdout + pino-roll + ring buffer stream
   - Development: `pino.multistream` with pino-pretty stdout + ring buffer stream
   - Formatters: level labels (string not number), ISO timestamps
   - Redaction: passwords, tokens, secrets, API keys
   - Export `setLogLevel(logger, level)` helper for runtime changes
5. [ ] Update `src/index.ts`
   - Create LogRingBuffer instance
   - Pass it to `createLogger()` and to `createServer()` deps
6. [ ] Update `src/api/server.ts`
   - Add `logBuffer` and `rootLogger` to ServerDeps
   - Register log routes
   - Pass logBuffer to WebSocket handler
7. [ ] Create `src/api/routes/logs.ts`
   - `GET /api/v1/logs` — query ring buffer, admin only
   - `GET /api/v1/logs/level` — return current level, admin only
   - `PUT /api/v1/logs/level` — change runtime level, admin only
8. [ ] Update `src/api/websocket.ts`
   - Add `"logs"` to `WsTopic` and `VALID_TOPICS`
   - On client subscribe to "logs": register ring buffer listener
   - On client disconnect: unsubscribe listener
   - Send log entries immediately (not batched)

### Frontend

9. [ ] Add `LogEntry` type to `ui/src/types.ts`
10. [ ] Add API functions to `ui/src/api.ts`: `fetchLogs()`, `getLogLevel()`, `setLogLevel()`
11. [ ] Create `ui/src/store/useLogStore.ts` — Zustand store
    - State: entries, live mode, filters, connected
    - Actions: connect (WS), disconnect, setFilter, toggleLive, clear
12. [ ] Create `ui/src/pages/LogsPage.tsx` — Log viewer page
    - Filter bar: level, module, search, live/pause toggle
    - Scrollable log list with color-coded entries
    - Auto-scroll in live mode, freeze in pause mode
    - Expandable entries for full context
13. [ ] Update `ui/src/App.tsx` — Add `/logs` route
14. [ ] Update `ui/src/components/layout/Sidebar.tsx` — Add "Logs" to ADMIN_ITEMS
15. [ ] Add i18n keys to `ui/src/i18n/en.json` and `ui/src/i18n/fr.json`

### Validation

16. [ ] Backend TypeScript compiles (`npx tsc --noEmit`)
17. [ ] Frontend TypeScript compiles (`cd ui && npx tsc --noEmit`)
18. [ ] Manual test: start engine, verify logs in console + file + ring buffer
19. [ ] Manual test: open UI log viewer, verify live streaming and filters
20. [ ] Manual test: change log level via API, verify it takes effect

## Testing

### Manual verification steps

1. Start engine with `npm run dev`
2. Verify pino-pretty logs appear in console with module context
3. Check `data/logs/` directory is created and `sowel.log` exists (production mode)
4. Call `GET /api/v1/logs` — verify entries returned
5. Call `GET /api/v1/logs?level=warn` — verify filtering works
6. Call `GET /api/v1/logs?module=mqtt` — verify module filter works
7. Call `PUT /api/v1/logs/level` with `{"level":"debug"}` — verify more logs appear
8. Open UI `/logs` page — verify entries load
9. Trigger MQTT activity — verify new entries appear in real time
10. Toggle pause — verify auto-scroll stops
11. Filter by level/module — verify list updates
