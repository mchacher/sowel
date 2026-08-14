# Spec 147 — Architecture

## Overview

Two thin persistence services, each modeled on `AuditLogger` (spec 113): a
prepared-statement `insert`, a `loadRecent`, and a `purgeOlderThan`, all
non-throwing. They are injected (optionally) into the two existing owners, which
keep their in-memory rings as the live read model and gain a persist-on-write +
load-on-boot behavior.

```
push()/journal()  ──▶  in-memory ring (unchanged read model)
        │
        └──▶ Store.insert(row)   (never throws; pino on failure)

boot:
  Store.loadRecent(window, cap)  ──▶ seed the in-memory ring
  Store.purgeOlderThan(7 days)   ──▶ trim the table
```

No new events, routes, WebSocket topics, or UI. `ActivityBuffer.getItems` and
`CapacityArbiter.getPublicState` are untouched — they simply return pre-seeded
data after a restart.

## Data model — migration `019_activity_arbiter_history.sql`

```sql
-- Spec 147 — persist the activity feed (spec 101) and the arbiter decision
-- journal (spec 140) across restarts. 7-day retention, purged at boot.

CREATE TABLE IF NOT EXISTS activity_log (
  id         TEXT PRIMARY KEY,
  timestamp  INTEGER NOT NULL,      -- epoch ms (ActivityItem.timestamp)
  category   TEXT NOT NULL,
  zone_id    TEXT,                  -- nullable (global items)
  message    TEXT NOT NULL,         -- JSON ActivityMessage {template, params}
  source     TEXT                   -- JSON OrderSource, nullable
);
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log (timestamp DESC);

CREATE TABLE IF NOT EXISTS arbiter_decision_log (
  id             TEXT PRIMARY KEY,
  at_iso         TEXT NOT NULL,     -- ISO 8601 (ArbiterDecision.atIso)
  kind           TEXT NOT NULL,
  equipment_id   TEXT,
  equipment_name TEXT,
  watts          REAL,
  reason         TEXT,
  note           TEXT
);
CREATE INDEX IF NOT EXISTS idx_arbiter_decision_log_at_iso ON arbiter_decision_log (at_iso DESC);
```

Rationale for two tables (not one generic log): the two records have different
native shapes (activity: category/zone/message/source, epoch-ms; decision:
kind/equipment/watts/reason, ISO). Two tables keep the mappers trivial and the
read models unchanged. `activity_log.timestamp` is epoch-ms INTEGER so the purge
is a numeric compare; `arbiter_decision_log.at_iso` is ISO TEXT so the purge uses
`datetime('now','-7 days')` like `audit_log`.

## Services

### `src/activity/activity-store.ts` — `ActivityStore`

```ts
export const ACTIVITY_RETENTION_DAYS = 7;

export class ActivityStore {
  constructor(db, logger) {
    /* prepare insert / loadRecent / purge / count */
  }
  insert(item: ActivityItem): void; // never throws
  loadRecent(limit: number): ActivityItem[]; // ORDER BY timestamp DESC LIMIT ?
  purgeOlderThan(days = ACTIVITY_RETENTION_DAYS): number;
}
```

- `insert`: `INSERT INTO activity_log (id, timestamp, category, zone_id, message, source)`
  with `message = JSON.stringify(item.message)`, `source = item.source ? JSON.stringify(...) : null`.
- `loadRecent`: `SELECT ... ORDER BY timestamp DESC LIMIT ?`, mapped back to
  `ActivityItem` (parse JSON columns). Returned newest-first — the same order the
  in-memory ring holds (`unshift`).
- `purgeOlderThan`: `DELETE FROM activity_log WHERE timestamp < ?` with cutoff
  `Date.now() - days * 86_400_000`.

### `src/energy/arbiter-journal-store.ts` — `ArbiterJournalStore`

```ts
export const ARBITER_JOURNAL_RETENTION_DAYS = 7;

export class ArbiterJournalStore {
  constructor(db, logger) {
    /* prepare stmts */
  }
  insert(d: ArbiterDecision): void; // never throws
  loadRecent(limit: number): ArbiterDecision[]; // oldest-first, last `limit`
  purgeOlderThan(days = ARBITER_JOURNAL_RETENTION_DAYS): number;
}
```

- `loadRecent`: select the most recent `limit` rows (`ORDER BY at_iso DESC LIMIT ?`)
  then reverse to **ascending** so it matches `journalEntries` in-memory order
  (which appends and reverses only in `getPublicState`).
- `purgeOlderThan`: `DELETE FROM arbiter_decision_log WHERE at_iso < datetime('now','-'||?||' days')`.

Both services follow `AuditLogger` exactly: constructor prepares statements, every
public method wraps its DB call in try/catch and logs `{ err }` via a child pino
logger, and returns a safe default on failure.

## Wiring

### `ActivityBuffer` (`src/activity/activity-buffer.ts`)

- Constructor gains an optional last parameter `store?: ActivityStore`.
- `push()` (line 104): after updating the ring, `this.store?.insert(item)`.
- `start()` (line 44): before subscribing, seed the ring from the store:
  `const recent = this.store?.loadRecent(MAX_ITEMS) ?? []; this.items.push(...recent)`
  (the store returns newest-first, so a direct push preserves order; guard against
  double-seeding by only seeding when `items` is empty).

### `CapacityArbiter` (`src/energy/capacity-arbiter.ts`)

- Constructor gains an optional `journalStore?: ArbiterJournalStore` (added after
  the existing params so `shadowMode`'s default position is preserved, or as a
  named/options addition — keep call sites explicit).
- `journal()` (line ~1132): after pushing to `journalEntries`,
  `this.journalStore?.insert(full)`.
- `start()`: seed `journalEntries` from
  `this.journalStore?.loadRecent(JOURNAL_CAP) ?? []` (ascending) when empty.

### Boot (`src/index.ts`)

- Instantiate both stores with the shared `db` and logger, next to the existing
  `AuditLogger` (around line 406).
- Pass `activityStore` into `new ActivityBuffer(...)` (line ~381) and
  `arbiterJournalStore` into `new CapacityArbiter(...)` (line ~325).
- Call `activityStore.purgeOlderThan()` and `arbiterJournalStore.purgeOlderThan()`
  at boot, alongside `auditLogger.purgeOlderThan()`.

## Files touched

| File                                          | Change                                             |
| --------------------------------------------- | -------------------------------------------------- |
| `migrations/019_activity_arbiter_history.sql` | two new tables + indexes                           |
| `src/activity/activity-store.ts`              | new `ActivityStore` service                        |
| `src/energy/arbiter-journal-store.ts`         | new `ArbiterJournalStore` service                  |
| `src/activity/activity-buffer.ts`             | optional store: persist-on-push + seed-on-start    |
| `src/energy/capacity-arbiter.ts`              | optional store: persist-on-journal + seed-on-start |
| `src/index.ts`                                | instantiate stores, inject, boot purge             |
| `src/activity/activity-store.test.ts`         | round-trip / reload / purge / never-throw          |
| `src/energy/arbiter-journal-store.test.ts`    | round-trip / reload / purge / never-throw          |

No changes to `src/shared/types.ts` (reuse `ActivityItem` / `ArbiterDecision`),
no API/WS/UI changes.
