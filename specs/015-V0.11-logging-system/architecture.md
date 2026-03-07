# Architecture: V0.11 Logging System

## Overview

Single pino root logger → 3 simultaneous outputs via `pino.multistream()`:

```
pino root logger (formatters, redaction, ISO timestamps)
        |
        +-- stdout (pino-pretty in dev, JSON in prod)
        +-- pino-roll file transport (data/logs/sowel.log, daily rotation)
        +-- Writable stream → LogRingBuffer (in-memory, 2000 entries)
                                    |
                                    +-- WebSocket "logs" topic (live tail)
                                    +-- REST GET /api/v1/logs (query)
```

## Data Model Changes

### No SQLite changes

Logs are NOT persisted in the database. The ring buffer is in-memory only, and file logs are handled by pino-roll. This keeps the system simple and avoids database bloat.

### New types in types.ts

```typescript
/** Log entry as stored in ring buffer and sent to UI */
export interface LogEntry {
  level: string; // "debug" | "info" | "warn" | "error" | "fatal"
  time: string; // ISO 8601
  module?: string; // e.g. "mqtt", "device-manager", "equipment-manager"
  msg: string; // Human-readable message
  [key: string]: unknown; // Additional context (deviceId, equipmentId, etc.)
}

/** Log level type for runtime level changes */
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal" | "silent";
```

## Event Bus Events

No new event bus events. Logs use a dedicated ring buffer subscription mechanism, not the EngineEvent pipeline. This keeps log streaming decoupled from the domain event system and avoids noise.

## MQTT Topics

No changes.

## API Changes

### New endpoints

| Method | Path                 | Auth  | Description                    |
| ------ | -------------------- | ----- | ------------------------------ |
| `GET`  | `/api/v1/logs`       | admin | Query ring buffer with filters |
| `PUT`  | `/api/v1/logs/level` | admin | Change runtime log level       |
| `GET`  | `/api/v1/logs/level` | admin | Get current log level          |

#### GET /api/v1/logs

Query params:

- `limit` (number, default 100, max 2000) — max entries to return
- `level` (string) — filter by minimum level (e.g. "warn" returns warn + error + fatal)
- `module` (string) — filter by module name (exact match)
- `search` (string) — substring search in `msg` field
- `since` (ISO date string) — only entries after this timestamp

Response:

```json
{
  "entries": [
    {
      "level": "info",
      "time": "2026-02-24T10:30:00.000Z",
      "module": "device-manager",
      "msg": "Device discovered",
      "deviceId": "0x00158d..."
    }
  ],
  "total": 42,
  "capacity": 2000,
  "currentLevel": "info"
}
```

#### PUT /api/v1/logs/level

Body: `{ "level": "debug" }`

Changes the runtime log level of the root pino logger (affects all child loggers). Takes effect immediately, no restart needed.

Response: `{ "level": "debug", "previous": "info" }`

#### GET /api/v1/logs/level

Response: `{ "level": "info" }`

### WebSocket changes

New topic `"logs"` added to `VALID_TOPICS`. When a client subscribes to the `logs` topic, it receives log entries in real time from the ring buffer subscription.

Log entries are sent **immediately** (not batched like engine events) for true live-tail behavior. They are sent as individual messages, not arrays:

```json
{
  "type": "log.entry",
  "level": "info",
  "time": "2026-02-24T10:30:00.000Z",
  "module": "mqtt",
  "msg": "Message received"
}
```

Clients can optionally specify a minimum level when subscribing:

```json
{ "type": "subscribe", "topics": ["logs"], "logLevel": "warn" }
```

## UI Changes

### New page: LogsPage

Route: `/logs` (added under admin section in sidebar + router)

### New component: LogViewer

Located at `ui/src/pages/LogsPage.tsx` (self-contained page component).

Features:

- **Header bar**: level filter dropdown, module filter dropdown, text search input, live/pause toggle, clear button
- **Log list**: virtualized scrollable list with auto-scroll in live mode
- **Entry format**: `[HH:mm:ss.SSS] [LEVEL] [module] message`
- **Colors**: error=red (`text-error`), warn=amber (`text-accent`), info=default (`text-text-secondary`), debug=muted (`text-text-tertiary`)
- **Font**: JetBrains Mono (`font-mono` in Tailwind config)
- **Expandable rows**: click to see full JSON context (deviceId, equipmentId, etc.)
- **Module dropdown**: populated dynamically from modules seen in current entries

### New store: useLogStore

Zustand store managing:

- `entries: LogEntry[]` — current displayed entries
- `live: boolean` — whether auto-scroll is active
- `filters: { level, module, search }` — active filters
- WebSocket subscription lifecycle

### Sidebar change

Add "Logs" nav item to `ADMIN_ITEMS` in `Sidebar.tsx`:

```typescript
{ to: "/logs", label: "nav.logs", icon: <ScrollText size={18} strokeWidth={1.5} /> }
```

### i18n keys

Add `nav.logs`, `logs.title`, `logs.live`, `logs.paused`, `logs.clear`, `logs.noEntries`, `logs.level`, `logs.module`, `logs.search`, `logs.allLevels`, `logs.allModules` to both `en.json` and `fr.json`.

## File Changes

| File                                   | Change                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| `package.json`                         | Add `pino-roll` dependency                                            |
| `src/core/log-buffer.ts`               | **NEW** — LogRingBuffer class (~60 lines)                             |
| `src/core/logger.ts`                   | Rewrite: multistream, formatters, redaction, ring buffer integration  |
| `src/shared/types.ts`                  | Add `LogEntry` and `LogLevel` types                                   |
| `src/index.ts`                         | Create LogRingBuffer, pass to createLogger and createServer           |
| `src/api/server.ts`                    | Add `logBuffer` to ServerDeps, register log routes, pass to WebSocket |
| `src/api/routes/logs.ts`               | **NEW** — GET /api/v1/logs, PUT/GET /api/v1/logs/level                |
| `src/api/websocket.ts`                 | Add "logs" topic, ring buffer subscriber per client                   |
| `ui/src/pages/LogsPage.tsx`            | **NEW** — Log viewer page                                             |
| `ui/src/store/useLogStore.ts`          | **NEW** — Zustand store for logs                                      |
| `ui/src/api.ts`                        | Add `fetchLogs()`, `getLogLevel()`, `setLogLevel()` API functions     |
| `ui/src/types.ts`                      | Add `LogEntry` type                                                   |
| `ui/src/App.tsx`                       | Add `/logs` route                                                     |
| `ui/src/components/layout/Sidebar.tsx` | Add "Logs" to ADMIN_ITEMS                                             |
| `ui/src/i18n/en.json`                  | Add log-related translation keys                                      |
| `ui/src/i18n/fr.json`                  | Add log-related translation keys                                      |

## Security

### Redaction

Configure at root logger level:

```typescript
redact: {
  paths: [
    "password", "*.password",
    "token", "*.token",
    "accessToken", "*.accessToken",
    "refreshToken", "*.refreshToken",
    "secret", "*.secret",
    "apiKey", "*.apiKey",
    "authorization", "req.headers.authorization",
    "mqttPassword", "*.mqttPassword",
  ],
  censor: "[REDACTED]",
}
```

### Access control

- All log endpoints require `admin` role
- WebSocket log subscription requires authentication (existing WS auth applies)
- Ring buffer is only accessible through the API layer

## Performance Considerations

- Ring buffer operations are O(1) push, O(n) query (n = buffer size, max 2000). Negligible.
- pino-roll runs file I/O in a worker thread — zero impact on main event loop.
- WebSocket log streaming is direct (not batched), but pino serialization is the bottleneck, not sending.
- Memory: 2000 entries × ~500 bytes average = ~1 MB. Trivial for a home automation box.
