# Implementation Plan: V0.11b Backup/Restore Hardening

## Tasks

1. [ ] Backend: Add FK integrity check in restore route (`backup.ts`)
2. [ ] Frontend: Create `BackupPage.tsx` (extract from SettingsPage)
3. [ ] Frontend: Add page reload after successful restore
4. [ ] Frontend: Add `/backup` route in `App.tsx`
5. [ ] Frontend: Add sidebar nav item in `Sidebar.tsx`
6. [ ] Frontend: Add i18n keys (`nav.backup`)
7. [ ] Frontend: Remove BackupSection from `SettingsPage.tsx`
8. [ ] Validate: `npx tsc --noEmit` (backend + frontend)
9. [ ] Validate: `npm test`

## Dependencies

- None — builds on existing backup/restore implementation

## Testing

- Export backup, verify JSON file downloads
- Import backup, verify page reloads and data is correct
- Import corrupted backup (bad FK references), verify 400 error with details
- Verify `/backup` page accessible from sidebar
- Verify backup no longer appears in Settings page
