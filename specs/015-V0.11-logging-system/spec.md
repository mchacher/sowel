# V0.11: Logging System

## Summary

Implement a unified logging system that serves three audiences simultaneously:

1. **Linux sysadmin** — structured JSON log files with rotation, compatible with `grep`, `jq`, `journalctl`
2. **Platform admin** — real-time log viewer in the UI with filtering by level, module, and text search
3. **Developer / AI debug** — rich structured context (module, deviceId, correlationId) accessible via console, files, and API

The system builds on the existing Pino logger with minimal changes to current logging call sites.

## Reference

- CLAUDE.md: "Structured JSON logging via pino (Fastify default)"
- Spec §4.1: Logging conventions
- Current implementation: `src/core/logger.ts` (14 lines, stdout only)

## Acceptance Criteria

### Backend — Logger Enhancement

- [ ] Pino logger outputs to 3 destinations simultaneously: stdout, file (pino-roll), in-memory ring buffer
- [ ] File transport rotates daily + at 10 MB, keeps 14 days of history
- [ ] Log files written to `data/logs/winch.log` with auto-created directory
- [ ] Ring buffer holds last 2000 entries in memory (configurable)
- [ ] Ring buffer captures at `debug` level; file transport at `info` level
- [ ] Sensitive fields (password, token, secret, apiKey) are redacted with `[REDACTED]`
- [ ] Log entries use human-readable level names (`info` not `30`)
- [ ] ISO 8601 timestamps on all entries

### Backend — API

- [ ] `GET /api/v1/logs` returns recent log entries from ring buffer
  - Query params: `limit` (default 100), `level`, `module`, `search`, `since`
  - Requires admin role
- [ ] `PUT /api/v1/settings/log-level` changes runtime log level without restart
  - Body: `{ "level": "debug" | "info" | "warn" | "error" }`
  - Requires admin role
- [ ] WebSocket topic `"logs"` streams log entries in real time
  - Clients can subscribe with optional level filter
  - Entries sent immediately (not batched like engine events)

### Frontend — Log Viewer

- [ ] New page accessible at Administration > Logs
- [ ] Displays log entries in a scrollable, monospace-font list
- [ ] Filter controls: level dropdown, module dropdown (populated from seen modules), text search
- [ ] Live mode: auto-scrolls as new entries arrive via WebSocket
- [ ] Pause mode: freezes display for consultation, resumes on click
- [ ] Color-coded levels: red = error, amber = warn, default = info, muted = debug
- [ ] Shows timestamp, level, module, message for each entry
- [ ] Expandable entries to see full structured data (deviceId, etc.)

## Scope

### In Scope

- Enhanced Pino logger with multistream (stdout + file + ring buffer)
- `pino-roll` for file rotation
- `LogRingBuffer` class (in-memory circular buffer)
- REST endpoint to query logs
- REST endpoint to change log level at runtime
- WebSocket topic for live log streaming
- UI log viewer page with filters and live/pause toggle
- Redaction of sensitive fields

### Out of Scope

- Log shipping to external systems (ELK, Loki, Datadog) — not needed for home automation
- Log persistence in SQLite or InfluxDB — ring buffer + files is sufficient
- Per-user log access control (admin-only is fine)
- Log alerts/notifications — scenarios handle this
- Audit log (who changed what) — separate concern for later
- Changing existing `logger.child()` call sites — they continue to work as-is

## Edge Cases

- **Ring buffer overflow**: Oldest entries are silently dropped (circular buffer behavior). No error, no warning.
- **Log file disk full**: pino-roll handles this gracefully; logs still go to stdout and ring buffer.
- **Many WebSocket log subscribers**: Each subscriber gets its own listener. Cap at ~10 concurrent log subscribers to prevent memory issues.
- **High-frequency debug logs**: Ring buffer at debug level may fill fast under heavy MQTT traffic. 2000 entries covers ~2-5 min of debug, ~15-30 min of info. This is acceptable for real-time monitoring.
- **Server restart**: Ring buffer is lost (by design). File logs persist. UI shows "no entries" until new logs arrive.
- **No auth configured (first-run)**: Log endpoints still require admin role. During first-run setup, logs are only available via console/files.
