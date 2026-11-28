# Spec 219 — Architecture

## Data model

Migration `047_mode_groups.sql`:

```sql
ALTER TABLE modes ADD COLUMN group_name TEXT;
ALTER TABLE modes ADD COLUMN activated_at TEXT;
UPDATE modes SET activated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) WHERE active = 1;
```

The backfill writes the same `YYYY-MM-DDTHH:MM:SS.sssZ` shape as `toISOString()`, so activation times
compare as strings.

A column on `modes` rather than a `mode_groups` table: a group has no attribute of its own (no
order, no icon), and an empty group must vanish, which a name on the mode gives for free. Can
become a table later if a group needs attributes.

`Mode` (`src/shared/types.ts`) gains:

```ts
group?: string;        // absent when ungrouped
activatedAt?: string;  // ISO, last activation; absent if never activated since spec 219
```

## Engine (`src/modes/mode-manager.ts`)

- `normalizeGroup(v)`: trim, empty to `null`, longer than 50 to `ModeError(400)`.
- `createMode(name, icon?, description?, group?)`, `updateMode(id, { …, group? })`
  (`group: null` or `""` clears, `undefined` keeps).
- `activateMode(id)`: if `mode.group`, one transaction sets `active = 0` on the other active
  modes of the group and `active = 1, activated_at = now` on the mode; then one
  `mode.deactivated` per sibling, the impacts, `mode.activated`.
- `updateMode`, after the write, when an active mode changes group: `resolveGroupConflict(group)`
  keeps the active mode with the latest `activated_at` (null oldest, ties to the mode just edited)
  and deactivates the others (flag and `mode.deactivated`). `createMode` needs none: a new mode is
  inactive.
- No new event type.

## API (`src/api/routes/modes.ts`)

`POST /api/v1/modes` and `PUT /api/v1/modes/:id` accept `group?: string | null`. Every mode
returned carries `group` when set. Permissions unchanged (create and update admin-only).

## UI

- `ui/src/types.ts`: `group?`, `activatedAt?` on `Mode`.
- `ui/src/lib/mode-groups.ts`: `groupModes(modes)` returns `{ groups: { name, modes }[], others }`,
  groups sorted by name; `modeGroupNames(modes)`. Tested.
- `ui/src/pages/ModesPage.tsx`: `ModeList` renders a group card whose rows are `ModeCard`
  with `grouped` (a radio instead of the switch), then « Autres modes ».
- `ui/src/components/layout/SidebarModeList.tsx`: group labels.
- `ui/src/components/modes/ModeForm.tsx`: « Groupe » select plus new-group input, conflict
  warning, the mode's own group always offered, saving blocked while a new group has no name;
  `ModesPage` and `ModeDetailPage` pass `group` and the mode list; `ModeDetailPage` loads the
  modes store itself.
- `ui/src/store/useModes.ts`, `ui/src/api/modes.ts`: `group` in create and update payloads.
- i18n EN and FR keys under `modes.group*`.

## Files

| File                                      | Change                      |
| ----------------------------------------- | --------------------------- |
| `migrations/047_mode_groups.sql`          | new                         |
| `src/shared/types.ts`                     | `Mode.group`, `activatedAt` |
| `src/modes/mode-manager.ts` (+ test)      | groups, exclusivity         |
| `src/api/routes/modes.ts`                 | `group` in bodies           |
| `ui/src/lib/mode-groups.ts` (+ test)      | new                         |
| UI pages, sidebar, form, store, api, i18n | as above                    |
| docs (see spec docs delta)                |                             |
