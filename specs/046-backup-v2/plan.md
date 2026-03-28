# Implementation Plan: Backup V2

## Tasks

### Backend — Export

1. [ ] Add `adm-zip` dependency (for restore ZIP reading — archiver already handles export)
2. [ ] Rewrite InfluxDB export: query with `collectRows()`, convert to line protocol strings, write as `.lp` files
3. [ ] Remove `equipment_data` measurement filter from InfluxDB export
4. [ ] Add `data/` folder to ZIP: `.jwt-secret`, `panasonic-tokens.json`, `netatmo-tokens.json` (skip if absent)
5. [ ] Remove JSON-only fallback — always produce ZIP
6. [ ] Bump backup version to `2`

### Backend — Restore

7. [ ] Change POST endpoint to accept `multipart/form-data` (ZIP file upload)
8. [ ] Parse ZIP: extract `sowel-backup.json`, validate version 2
9. [ ] Restore SQLite tables (existing logic, unchanged)
10. [ ] Extract and restore `influx-*.lp` files: write to correct buckets via `writeApi.writeLines()`
11. [ ] Extract and restore `data/*` files: write to filesystem
12. [ ] Log summary: tables restored, InfluxDB points written, files restored

### Frontend

13. [ ] Update `importBackup()` in `api.ts` to send ZIP as `FormData` binary instead of JSON

### Validation

14. [ ] TypeScript compilation (backend + frontend)
15. [ ] All tests pass
16. [ ] Manual test: export backup, inspect ZIP contents
17. [ ] Manual test: restore backup on running instance

## Dependencies

- `archiver` (already installed) — ZIP creation
- `adm-zip` (to install) — ZIP reading on restore

## Testing

- Export: download ZIP, verify it contains `.json`, `.lp` files, and `data/` folder
- Restore: upload the exported ZIP, verify SQLite data restored, InfluxDB data present, token files written
- Edge case: export/restore with InfluxDB disconnected (should still work for SQLite + files)
