# Backup V2 — Full System Backup & Restore

## Summary

Overhaul the backup system to provide a complete, restorable backup of all Sowel state: SQLite configuration, InfluxDB time-series history, and persistent file-based state (OAuth tokens, JWT secret). The export format changes from version 1 (JSON + annotated CSV) to version 2 (ZIP with line protocol). No backward compatibility with V1.

## Reference

- Audit findings from 2026-03-28 conversation
- CLAUDE.md § Energy Monitoring (InfluxDB)

## Acceptance Criteria

- [ ] Export always produces a ZIP file (no JSON-only fallback)
- [ ] ZIP contains: `sowel-backup.json` (v2), InfluxDB `.lp` files, `data/` folder with token files
- [ ] InfluxDB exported as line protocol (no annotated CSV, no measurement filter)
- [ ] Restore accepts a ZIP file via `POST /api/v1/backup` (multipart/form-data)
- [ ] Restore re-inserts SQLite data with FK integrity check
- [ ] Restore writes InfluxDB line protocol back to correct buckets
- [ ] Restore writes OAuth token files and JWT secret back to `data/`
- [ ] UI sends ZIP as binary (not JSON-parsed)
- [ ] TypeScript compiles with zero errors
- [ ] All existing tests pass

## Scope

### In Scope

- Backup format V2 (breaking change, no V1 compat)
- InfluxDB export as line protocol, restore via writeApi
- OAuth token files (panasonic-tokens.json, netatmo-tokens.json) in ZIP
- JWT secret (.jwt-secret) in ZIP
- UI update to send ZIP binary on import
- Backend accepts multipart/form-data ZIP on restore

### Out of Scope

- Selective backup (choose what to include)
- Scheduled/automatic backups
- Hot reload of managers post-restore (manual server restart required)
- Plugin source code in ZIP (reinstall from GitHub via repo field)

## Edge Cases

- InfluxDB not connected at export time: export ZIP without .lp files (SQLite + data files only)
- InfluxDB not connected at restore time: restore SQLite + data files, skip InfluxDB, log warning
- Token files don't exist at export time: skip them (no error)
- Bucket doesn't exist at restore time: create it or skip with warning
- Empty .lp file: skip writing to that bucket
