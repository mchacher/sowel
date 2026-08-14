# Spec 147 — Implementation plan

Branch: `feat/issue-494-persist-activity-arbiter-history`

## Tasks

### Database

- [x] 1. Migration `019_activity_arbiter_history.sql`: `activity_log` +
     `arbiter_decision_log` tables and their `timestamp`/`at_iso` indexes.

### Services

- [x] 2. `src/activity/activity-store.ts` — `ActivityStore` (insert / loadRecent /
     purgeOlderThan, never-throw, `ACTIVITY_RETENTION_DAYS = 7`).
- [x] 3. `src/energy/arbiter-journal-store.ts` — `ArbiterJournalStore` (insert /
     loadRecent / purgeOlderThan, never-throw, `ARBITER_JOURNAL_RETENTION_DAYS = 7`).

### Wiring

- [x] 4. `ActivityBuffer`: optional `store?: ActivityStore`; persist in `push()`;
     seed the ring in `start()` when empty.
- [x] 5. `CapacityArbiter`: optional `journalStore?: ArbiterJournalStore`; persist
     in `journal()`; seed `journalEntries` in `start()` when empty.
- [x] 6. `src/index.ts`: instantiate both stores, inject into `ActivityBuffer` and
     `CapacityArbiter`, and call `purgeOlderThan()` at boot.

### Tests

- [x] 7. `activity-store.test.ts` — scenarios below.
- [x] 8. `arbiter-journal-store.test.ts` — scenarios below.

### Docs / release

- [ ] 9. `sowel-docs`: note persistence in the architecture "Activity Buffer" and
     arbiter sections (they currently say "lost on restart").
- [ ] 10. Release notes entry (EN + FR) at release time (spec 108).

## Test Plan

### Modules to test

- `ActivityStore` (new persistence + mapping + purge).
- `ArbiterJournalStore` (new persistence + mapping + purge + ordering).

Both are the pieces with business logic. `ActivityBuffer` / `CapacityArbiter`
already have tests; the store injection is exercised through the store tests
(the in-memory rings are unchanged). We do not add React tests (no UI change).

### Scenarios

| Module              | Scenario                       | Expected                                                                  |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| ActivityStore       | insert then loadRecent         | item round-trips (category, zoneId, message JSON, source JSON, timestamp) |
| ActivityStore       | loadRecent ordering            | newest-first (matches the in-memory ring's `unshift` order)               |
| ActivityStore       | loadRecent limit               | returns at most `limit` rows                                              |
| ActivityStore       | null zoneId / undefined source | stored and read back as null/undefined without loss                       |
| ActivityStore       | purgeOlderThan(7)              | rows older than 7 days deleted, recent kept; returns count removed        |
| ActivityStore       | insert on a broken db          | does not throw; error logged                                              |
| ArbiterJournalStore | insert then loadRecent         | decision round-trips (kind, equipmentId/name, watts, reason, note, atIso) |
| ArbiterJournalStore | loadRecent ordering            | ascending (oldest-first), matching `journalEntries` in-memory order       |
| ArbiterJournalStore | loadRecent limit = JOURNAL_CAP | returns the most recent `cap` rows, ascending                             |
| ArbiterJournalStore | purgeOlderThan(7)              | rows older than 7 days deleted, recent kept                               |
| ArbiterJournalStore | insert on a broken db          | does not throw; error logged                                              |

### Manual verification

- Start the engine, generate a few activities and (with the arbiter enabled) a
  few decisions, restart the container, confirm the activity feed and the arbiter
  decision journal are still populated in the UI.
- Confirm the arbiter's live grants/suspensions are NOT restored (rebuilt from
  events), i.e. no stale suspension appears right after a restart.
