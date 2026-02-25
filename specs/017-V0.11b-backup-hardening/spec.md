# V0.11b: Backup/Restore Hardening

## Summary

Harden the existing backup/restore feature with FK integrity validation and post-restore page reload. Move the backup UI from the Settings page into a dedicated `/backup` page accessible from the Administration sidebar section.

## Reference

- Existing implementation: `src/api/routes/backup.ts`, `ui/src/pages/SettingsPage.tsx` (BackupSection)
- Audit findings: missing `PRAGMA foreign_key_check`, no post-restore reload, UI buried in Settings

## Acceptance Criteria

- [ ] Backend runs `PRAGMA foreign_key_check` after restore and reports violations
- [ ] Frontend reloads the page after a successful restore
- [ ] New `/backup` route with dedicated `BackupPage`
- [ ] Sidebar Administration section includes a "Backup" nav item
- [ ] `BackupSection` removed from `SettingsPage`
- [ ] TypeScript compiles with zero errors (backend + frontend)
- [ ] All tests pass

## Scope

### In Scope

- FK integrity check after restore (backend)
- Page reload after successful restore (frontend)
- Dedicated BackupPage at `/backup`
- Sidebar nav item in Administration section
- Remove backup from Settings page

### Out of Scope

- Schema version migration during restore (deferred)
- Pre-restore automatic backup (deferred)
- Credential redaction in backup files (deferred)
- Selective table backup (deferred)
- Backend re-initialization after restore (page reload is sufficient)

## Edge Cases

- FK violations after restore: return 400 with details, rollback the transaction
- Empty backup file: handled by existing validation (`version !== 1`)
- Backup from older schema (missing columns): INSERT will fail, transaction rolls back
