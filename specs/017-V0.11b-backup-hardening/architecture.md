# Architecture: V0.11b Backup/Restore Hardening

## Data Model Changes

None — no schema changes.

## Event Bus Events

None — no new events.

## API Changes

### Modified: POST `/api/v1/backup` (restore)

After re-enabling foreign keys, run `PRAGMA foreign_key_check`. If violations are found, roll back the transaction and return 400 with violation details.

```typescript
// Inside the transaction, after re-enabling FK:
db.pragma("foreign_keys = ON");
const violations = db.pragma("foreign_key_check") as FKViolation[];
if (violations.length > 0) {
  throw new Error(`FK integrity violations: ${violations.length} found`);
}
```

Note: `PRAGMA foreign_key_check` returns rows with `(table, rowid, parent, fkid)` for each violation.

## UI Changes

### New: `ui/src/pages/BackupPage.tsx`

Dedicated admin page for backup/restore. Content extracted from `SettingsPage.tsx` BackupSection (lines 620-702), adapted to full-page layout.

### Modified: `ui/src/pages/SettingsPage.tsx`

Remove `BackupSection` component and its import/usage. Settings page keeps: Profile, Preferences, Password, API Tokens, User Management.

### Modified: `ui/src/App.tsx`

Add route: `<Route path="/backup" element={<BackupPage />} />`

### Modified: `ui/src/components/layout/Sidebar.tsx`

Add nav item to `ADMIN_ITEMS` array:

```typescript
{ to: "/backup", label: "nav.backup", icon: <DatabaseBackup /> }
```

### Modified: `ui/src/i18n/locales/fr.json` + `en.json`

Add translation key: `nav.backup` → "Sauvegarde" / "Backup"

## File Changes

| File                                   | Change                               |
| -------------------------------------- | ------------------------------------ |
| `src/api/routes/backup.ts`             | Add FK integrity check after restore |
| `ui/src/pages/BackupPage.tsx`          | New dedicated backup page            |
| `ui/src/pages/SettingsPage.tsx`        | Remove BackupSection                 |
| `ui/src/App.tsx`                       | Add `/backup` route                  |
| `ui/src/components/layout/Sidebar.tsx` | Add backup nav item                  |
| `ui/src/i18n/locales/fr.json`          | Add `nav.backup` key                 |
| `ui/src/i18n/locales/en.json`          | Add `nav.backup` key                 |
