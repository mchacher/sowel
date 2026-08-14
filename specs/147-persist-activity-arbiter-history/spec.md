# Spec 147 — Persist the activity feed and the arbiter decision journal

## Context

Two histories are lost on every container restart or update, exactly when you
most want to look back at what happened:

- **Activity feed** (spec 101) — `ActivityBuffer` keeps a 2000-item / 24h
  in-memory ring (`src/activity/activity-buffer.ts:28`). Nothing is persisted.
- **Energy arbiter decision journal** (spec 140) — `CapacityArbiter` keeps a
  200-entry in-memory ring (`src/energy/capacity-arbiter.ts:125`). Nothing is
  persisted.

Sowel already has the right pattern for a bounded, timestamped, append-only log
that survives restarts: the `audit_log` table + `AuditLogger` (spec 113), with a
boot-time retention purge (`src/core/audit-logger.ts:49`, purged in
`src/index.ts`). This spec applies that pattern to the two histories.

## Goals

- The **activity feed** and the **arbiter decision journal** survive a restart:
  recent entries are reloaded on boot into their existing read models.
- Reuse the `audit_log` approach: one SQLite table per history, persist-on-write,
  load-recent-on-boot, 7-day retention purged at boot.
- Zero change to the existing read models, API routes, WebSocket topics, and UI —
  they simply start pre-populated after a restart.

## Non-goals / explicitly out of scope (v1)

- **Restoring the arbiter's live control state** — current claims/grants, the
  suspension timers (`overridesUntil`), and the surplus series
  (`capacity-arbiter.ts:124,136,156`) are NOT persisted or restored. Restoring
  stale control state after an update is unsafe (a manual-override suspension from
  before the update may no longer be valid), and the arbiter rebuilds this state
  from live events within one evaluation cycle by design. Only the **decision
  journal** (history) is persisted.
- No new API route, no new WebSocket event, no UI change. The read models
  (`ActivityBuffer.getItems`, `CapacityArbiter.getPublicState`) are unchanged.
- No InfluxDB involvement (optional in a Sowel install; wrong shape for discrete
  templated events).
- No configurable retention setting in v1 — 7 days is hard-coded like
  `audit_log`'s 365, and can be lifted to a setting later.

## Requirements

1. A new SQLite table persists each activity item as it is pushed, and each
   arbiter decision as it is journaled.
2. On boot, `ActivityBuffer` and `CapacityArbiter` load their recent persisted
   entries (within the retention window, capped to their existing in-memory ring
   sizes) so the read models are populated before the first client connects.
3. At boot, entries older than **7 days** are purged from both tables.
4. Persistence must **never throw** into the engine: a DB write failure is logged
   via pino and the in-memory ring continues to work (degraded to pre-147
   behavior).
5. The in-memory ring caps (`MAX_ITEMS = 2000`, `JOURNAL_CAP = 200`) still bound
   live memory; persistence is additive.

## Acceptance criteria

- [x] A migration (`019`) creates an `activity_log` table and an
      `arbiter_decision_log` table, mirroring the `audit_log` shape.
- [x] Every activity item pushed by `ActivityBuffer` is persisted; every decision
      journaled by `CapacityArbiter` is persisted.
- [x] On boot, the activity feed reloads the last 7 days (up to `MAX_ITEMS`) and
      the arbiter journal reloads the last 7 days (up to `JOURNAL_CAP`), newest
      entries first in the read model, matching pre-restart ordering.
- [x] Boot-time purge deletes entries older than 7 days from both tables.
- [x] A DB failure on write or load is swallowed (logged, not thrown); the engine
      runs with the in-memory ring only.
- [x] The arbiter's live control state (claims, suspensions, surplus) is NOT
      persisted or restored — unchanged behavior.
- [x] No change to REST routes, WebSocket topics, or the UI.
- [x] Tests: persistence round-trip, boot reload, retention purge, and
      never-throw on a failing store, for both histories.

## Edge cases

- Empty tables on first boot after the migration → read models start empty
  (current behavior).
- Store injection absent (unit tests, or a future opt-out) → in-memory only, no
  persistence, no crash.
- Shadow mode: activities still persist to the shadow's own DB copy (harmless);
  the arbiter does not arbitrate in shadow so it journals nothing new.
- Clock/timestamp: activity items use epoch-ms (`ActivityItem.timestamp`);
  arbiter decisions use ISO (`ArbiterDecision.atIso`). Each table stores its
  native form and the retention purge matches it.
- A very large backlog within 7 days → boot load is capped to the ring size, so
  memory stays bounded regardless of table size.
