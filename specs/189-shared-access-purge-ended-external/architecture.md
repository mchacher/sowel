# Spec 189 — Architecture

No schema change, no new event, no API change.

## Store (`src/shared-access/shared-access-store.ts`)

- New prepared statement `endedExternals`: `SELECT * FROM shared_accesses WHERE kind = 'external'
AND ((valid_until IS NOT NULL AND valid_until < @before) OR (revoked_at IS NOT NULL AND
revoked_at < @before))` — the predicate of `nullEndedCodes`, restricted to external accesses.
  `valid_until` is the date in force, so an owner's extension already moves it.
- `purge(opts)` is unchanged. Add a separate reader `endedExternalAccesses(before: number):
AccessRow[]`; the manager deletes through the existing `deleteAccess` / `addTombstone` store
  methods, so the journal and tombstone logic stays in one place.

## Manager (`src/shared-access/shared-access-manager.ts`)

`purge()`:

```
const before = now - CODE_KEPT_AFTER_END_MS;
const ended = store.endedExternalAccesses(before);
store.transaction(() => {
  for (const row of ended) {
    journal(row, "deleted", { actor: "housekeeping" });
    if (row.source_plugin && row.external_id) store.addTombstone(row.source_plugin, row.external_id, now);
    store.deleteAccess(row.id);
  }
});
for (const row of ended) resolvePhoneAlarm(row);
const result = store.purge({...});           // unchanged: codes, journal, tombstones
log { ...result, accesses: ended.length } when anything changed
if (ended.length > 0) changed();
```

Order matters: delete before `store.purge()` so the fresh `deleted` journal line is not counted as
excess in the same run, and the tombstone purge (a year) never sees a tombstone written now.

Use a constant `HOUSEKEEPING_ACTOR = "housekeeping"` next to the other constants. Do not call
`deleteAccess(id, actor)` (the public method): it asserts the feature is enabled and calls
`changed()` per line.

## Files

| File                                              | Change                                                 |
| ------------------------------------------------- | ------------------------------------------------------ |
| `src/shared-access/shared-access-store.ts`        | `endedExternals` statement + `endedExternalAccesses()` |
| `src/shared-access/shared-access-manager.ts`      | `purge()` deletes ended externals                      |
| `src/shared-access/shared-access-manager.test.ts` | tests of the plan                                      |
| `specs/181-shared-access/spec.md`                 | R10: add item 37 pointing to spec 189                  |
| `docs/user/shared-access.md`, `.fr.md`            | one sentence each                                      |
| `docs/specs-index.md`                             | add spec 189                                           |
