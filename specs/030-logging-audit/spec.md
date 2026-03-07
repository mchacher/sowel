# Logging Audit & Improvement

## Summary

Comprehensive logging refactoring to make Sowel logs actionable for operators and developers. Logs should tell the story of what Sowel is doing — not just that something happened, but what, why, and with which entities.

## Reference

- CLAUDE.md § Logging (level strategy, domain guidelines, structured context)

## Problems Identified

### A. Wrong log levels

- Zone aggregation per-zone update at `debug` instead of `trace` (hot path, fires N times per equipment change)
- History cache refresh at `debug` instead of `trace`
- Integration polling "Polling X..." at `debug` instead of `trace`

### B. Missing human-readable context

- Zone aggregation: only UUID, no zone name
- Equipment order execution: no equipment name, no zone name
- Mode impacts: no zone name
- Recipe instances: no recipe type/name
- MQTT connector: no broker URL on connect/disconnect/reconnect
- Device summary: string interpolation instead of structured context

### C. Silent functional flows (no logging at all)

- **Equipment data pipeline**: `handleDeviceDataUpdated` — zero logging for binding propagation
- **MQTT publish service**: `handleEquipmentDataChanged/handleZoneDataChanged/handleRecipeStateChanged` — silent publishes
- **Auth**: no login success/failure, no token refresh, no JWT verification
- **Recipe execution**: trigger/condition/action only logged via internal `ctx.log()`, invisible to main logger
- **History writer**: deadband filtering, write throttling invisible
- **Button actions**: effect execution invisible (only "matched" logged)
- **Backup/restore**: no per-table row counts

### D. Incomplete error context

- Backup restore failed: no table/row context
- Recipe instance start/restart failed: no recipe type
- Integration order dispatch failed: no equipment/device name

## Acceptance Criteria

### Iteration 1: Fix existing logs

- [ ] Zone aggregation: debug→trace for per-zone update, add zone name, remove full aggregatedData dump
- [ ] Zone aggregation: add debug summary per recomputeZoneChain (trigger source, zones updated count, changed fields)
- [ ] Device summary: structured context instead of string interpolation
- [ ] Equipment order: add equipment name and zone name to info/debug/error logs
- [ ] Mode impacts: add zone name to activation logs
- [ ] Recipe instances: add recipe type/name to start/stop/error logs
- [ ] MQTT connector: add broker URL to connect/disconnect/reconnect logs
- [ ] Integration polling: debug→trace for per-cycle "Polling..." messages
- [ ] History cache refresh: debug→trace
- [ ] All error logs: ensure equipment/device/zone names present alongside IDs

### Iteration 2: Fill functional gaps

- [ ] Equipment data pipeline: add debug log in handleDeviceDataUpdated showing binding match + value propagation
- [ ] MQTT publish service: add trace log per publish, debug summary per event batch
- [ ] Auth: add info log for login success, warn for login failure, debug for token refresh
- [ ] Recipe execution: add debug logs for trigger evaluation, condition check, action execution to main logger
- [ ] History writer: add trace log for write/skip decisions (deadband, throttle)
- [ ] Button actions: add debug log for effect execution result
- [ ] Backup: add info log with per-table row counts on export/restore

## Scope

### In Scope

- Backend logging only (src/)
- Level corrections, context enrichment, new log calls
- No behavioral changes, no API changes, no UI changes

### Out of Scope

- Log viewer UI improvements
- Log rotation/retention configuration
- Performance benchmarking of logging overhead
