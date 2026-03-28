# Architecture: Backup V2

## ZIP Structure

```
sowel-backup-2026-03-28.zip
├── sowel-backup.json              # SQLite data (version: 2)
├── influx-raw.lp                  # Line protocol — sowel bucket (7d)
├── influx-hourly.lp               # Line protocol — sowel-hourly bucket (90d)
├── influx-daily.lp                # Line protocol — sowel-daily bucket (5y)
├── influx-energy-hourly.lp        # Line protocol — sowel-energy-hourly bucket (2y)
├── influx-energy-daily.lp         # Line protocol — sowel-energy-daily bucket (10y)
└── data/
    ├── .jwt-secret                # JWT signing secret
    ├── panasonic-tokens.json      # Panasonic CC OAuth tokens (if exists)
    └── netatmo-tokens.json        # Netatmo HC OAuth tokens (if exists)
```

## Data Model Changes

- `BackupPayload.version` changes from `1` to `2`
- No new SQLite tables or columns
- No new types in types.ts

## API Changes

### `GET /api/v1/backup` (Export)

**Response**: Always ZIP (no JSON fallback)

Changes:

- InfluxDB query uses `toLineProtocol()` flux function instead of `queryRaw()` CSV
- Remove `equipment_data` measurement filter
- Add `data/` folder to ZIP with token files and JWT secret
- Content-Type always `application/zip`

### `POST /api/v1/backup` (Restore)

**Request**: Changes from `application/json` body to `multipart/form-data` with ZIP file

Changes:

- Parse ZIP file (using `unzipper` or `yauzl` or manual ZIP parsing)
- Extract `sowel-backup.json` → restore SQLite (existing logic)
- Extract `influx-*.lp` files → write to InfluxDB via `writeApi.writeLines()`
- Extract `data/*` files → write to filesystem

## InfluxDB Export Strategy

### Current (V1): Annotated CSV via queryRaw

```flux
from(bucket: "sowel")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "equipment_data")
```

→ Returns CSV with `#group`, `#datatype` headers. Not writable back.

### New (V2): Line Protocol

Two approaches available:

**Option A — Server-side conversion**: Query with Flux, iterate rows, build line protocol strings manually.

**Option B — Flux `experimental/csv.from` + raw export**: Not applicable since we need line protocol output.

**Chosen: Option A** — Query normally via `collectRows()`, convert each row to line protocol format:

```
measurement,tag1=val1,tag2=val2 field1=value1,field2=value2 timestamp_ns
```

## InfluxDB Restore Strategy

Use `writeApi.writeLines()` method which accepts line protocol strings directly.

- Create a WriteApi per bucket with large batch size (5000)
- Split .lp file content by newlines
- Write in batches of 5000 lines
- Call `writeApi.close()` to flush after each bucket

## File Changes

| File                          | Change                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/api/routes/backup.ts`    | Rewrite export (line protocol + data files) and restore (ZIP parsing + InfluxDB write + file restore) |
| `ui/src/api.ts`               | `importBackup()` sends ZIP as FormData binary instead of JSON                                         |
| `ui/src/pages/BackupPage.tsx` | No changes needed (already accepts .zip)                                                              |
| `package.json`                | Add `adm-zip` dependency for ZIP reading on restore                                                   |
