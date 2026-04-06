# 059 — Remote Plugin Registry + InfluxDB Restore Fix

## Summary

Two changes:

### 1. Remote Plugin Registry

Replace the local hardcoded `plugins/registry.json` with a remote fetch from GitHub. Plugin updates and new packages are visible immediately without releasing a new Sowel Docker image.

- Fetch from `https://raw.githubusercontent.com/mchacher/sowel/main/plugins/registry.json`
- Cache in memory with 1h TTL
- Fallback to local file if network unavailable
- Affects: `getStore()`, `getLatestVersions()` in PackageManager

### 2. InfluxDB Restore — Ensure Buckets Exist

Backup restore writes InfluxDB line protocol data to energy buckets that may not exist on a fresh InfluxDB instance. The `ensureEnergyBuckets()` runs on startup but the restore happens before restart.

Fix: call `ensureBuckets()` + `ensureEnergyBuckets()` before writing InfluxDB data during restore.

## Files Changed

| File                              | Change                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| `src/packages/package-manager.ts` | Fetch registry from GitHub, cache with TTL, fallback to local |
| `src/api/routes/backup.ts`        | Ensure InfluxDB buckets exist before restoring data           |

## Acceptance Criteria

- [ ] Store and version checks use remote registry from GitHub
- [ ] Registry cached with 1h TTL (no fetch on every API call)
- [ ] Fallback to local `plugins/registry.json` when offline
- [ ] InfluxDB restore creates buckets before writing data
- [ ] Energy data fully restored on fresh InfluxDB instance
- [ ] TypeScript compiles, all tests pass, lint clean
