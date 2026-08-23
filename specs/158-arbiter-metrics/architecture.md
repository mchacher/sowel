# Spec 158 — Architecture

## 1. Overview

Pure instrumentation, bolted on the side of the arbiter rather than into it.

```
  CapacityArbiter  (UNCHANGED — not one line)
        │ journals decisions / surplus samples (existing behaviour)
        ▼
  arbiter_decision_log ─┐
  arbiter_surplus_log  ─┤   7-day retention
                        │
                        ▼
              ArbiterMetricsRollup            hour-aligned timer
                 │  reads both stores over one local day
                 │  reuses sustainedAfter() from arbiter-timeline.ts
                 │  reads load profiles from EquipmentManager
                 ▼
              rollupDay()  (pure, no I/O, no clock)
                 ▼
              ArbiterMetricsStore  ──▶  arbiter_daily_load_metrics
                                        arbiter_daily_home_metrics
                                            400-day retention
                                                  │
                          ┌───────────────────────┴───────────────────┐
                          ▼                                           ▼
      GET /api/v1/energy/arbiter/metrics            scripts/energy/arbiter-metrics.ts
                                                    (reads SQLite directly)
```

The key structural decision: **the rollup never talks to `CapacityArbiter`.**
Everything it needs is already elsewhere. The decisions and surplus samples are
in the two persisted stores, the load profiles (`minOnS`, `nominalPowerW`,
`toleratedImportW`) are on the equipments, and `engageMarginW` / `releaseHoldS`
are in the settings table. So the arbiter is not modified, not re-wired, and
cannot be destabilised by this change. That is the whole point of shipping the
instrumentation before anything that touches control.

## 2. Data model

### 2.1 New tables (migration `025_arbiter_daily_metrics.sql`)

```sql
-- Spec 158 — per-load, per-local-day arbitration metrics. Rolled up hourly
-- from arbiter_decision_log; idempotent per (day, equipment_id). 400-day
-- retention, purged at boot.
CREATE TABLE IF NOT EXISTS arbiter_daily_load_metrics (
  day           TEXT NOT NULL,    -- local YYYY-MM-DD
  equipment_id  TEXT NOT NULL,
  grants        INTEGER NOT NULL DEFAULT 0,
  revokes       INTEGER NOT NULL DEFAULT 0,
  short_cycles  INTEGER NOT NULL DEFAULT 0,
  granted_s     INTEGER NOT NULL DEFAULT 0,
  pending_s     INTEGER NOT NULL DEFAULT 0,
  unmanaged_s   INTEGER NOT NULL DEFAULT 0,
  suspended_s   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, equipment_id)
);

-- Spec 158 — home-level, per-local-day energy balance as the arbiter saw it,
-- integrated from the 5-min signed surplus samples.
CREATE TABLE IF NOT EXISTS arbiter_daily_home_metrics (
  day                       TEXT PRIMARY KEY, -- local YYYY-MM-DD
  export_wh                 REAL NOT NULL DEFAULT 0,
  import_wh                 REAL NOT NULL DEFAULT 0,
  idle_claimable_export_wh  REAL NOT NULL DEFAULT 0,
  samples                   INTEGER NOT NULL DEFAULT 0
);
```

`samples` is the honesty column: a day with 40 samples instead of ~288 is a day
the instance was mostly down, and the reader must be able to tell.

### 2.2 Types (`src/shared/types.ts`) — additive only

```ts
export interface ArbiterDailyLoadMetrics {
  day: string;
  equipmentId: string;
  equipmentName: string; // resolved at read time, falls back to the id
  grants: number;
  revokes: number;
  shortCycles: number;
  grantedS: number;
  pendingS: number;
  unmanagedS: number;
  suspendedS: number;
}

export interface ArbiterDailyHomeMetrics {
  day: string;
  exportWh: number;
  importWh: number;
  /** Estimate: 5-min sampling, profile evaluated at rollup time. */
  idleClaimableExportWh: number;
  samples: number;
}

export interface ArbiterMetricsResponse {
  from: string;
  to: string;
  home: ArbiterDailyHomeMetrics[];
  loads: ArbiterDailyLoadMetrics[];
  /** Flags idleClaimableExportWh as an estimate for any consumer. */
  estimates: string[];
}
```

No existing type changes shape. `ArbiterPublicState` is untouched, so the UI
store and every existing component keep compiling unmodified.

### 2.3 No new settings

The rollup reads `energy.arbiter.engageMarginW` and
`energy.arbiter.releaseHoldS` through the existing `SettingsManager` to compute
`needW` and the short-cycle window. It introduces no key of its own and changes
no default.

## 3. New modules

### 3.1 `src/energy/arbiter-metrics.ts` (pure, fully unit-testable)

No DB, no clock, no I/O. Everything is passed in.

```ts
export interface RollupInput {
  dayStartMs: number; // local midnight
  dayEndMs: number; // next local midnight
  decisions: ArbiterDecision[]; // ordered, day window plus entering-state lookback
  surplus: SurplusSample[];
  loads: Array<{
    equipmentId: string;
    minOnS: number;
    needW: number; // nominalPowerW + engageMarginW - toleratedImportW
  }>;
  releaseHoldS: number;
}

export function rollupDay(input: RollupInput): {
  loads: LoadMetricRow[];
  home: HomeMetricRow;
};
```

**Span reconstruction** reuses `sustainedAfter()` from `arbiter-timeline.ts`, so
"granted", "pending" and "unmanaged" mean exactly what the timeline paints. One
definition of arbiter state in the codebase, not two. The entering state of a
day comes from the last decision before `dayStartMs` per load, mirroring the
24 h lookback `getTimeline()` already performs.

**Short cycle**: a `granted` at `t0` followed by a `revoked` for the same
equipment at `t1` with `t1 - t0 < (minOnS + releaseHoldS) * 1000` **and a
reason of `surplus-deficit`**. `minOnS` is per load and arrives through
`loads`, keeping the module manager-free.

The reason gate matters: the arbiter shields a load inside its own `minOnS`
(release pass, "an unresolvable deficit simply waits"), so any revoke landing
in `[0, minOnS)` is by construction a _hard_ revoke — `manual-override`,
`meter-stale`, `disabled`. A user flipping the pool pump off at the wall five
minutes after a grant would otherwise be recorded as arbiter regret.
`priority-preempted` is excluded for the same reason: it is a deliberate
arbitration decision, not a misjudged engage.

**Revoke counting** uses `revoked` only. `revoke-not-honored` is journaled ON
TOP of the `revoked` it follows (the arbiter pushes a watchdog inside
`revoke()`, and the watchdog writes the follow-up when the load did not stop),
so counting both would report two revocations for one. The timeline can lump
them together because painting a quarter red twice is idempotent; a counter
cannot.

**Open suspensions are bounded by the override TTL.** `overridesUntil` is
in-memory, a restart drops every suspension without journaling anything, and
the arbiter's startup reconciliation only closes tails whose sustained state is
`granted` or `pending`. A manual override at 18:00 followed by a container
restart would otherwise bill the rest of the day, and through the 48 h lookback
the whole of the next one. So a suspension with no state transition inside its
own TTL is closed at the TTL, which is what the arbiter would have done had it
stayed up; and any later state transition (a grant, a claim, a revoke) closes
it immediately, since the arbiter cannot act on a suspended load.

**Two export figures, deliberately separate.** For each surplus sample with
`availableW > 0` and a load whose `needW <= availableW`:

- `waitingExportWh` accumulates when the load is `pending` — claiming and not
  granted. The arbiter's own miss.
- `idleClaimableExportWh` accumulates when a **deferrable** load is neither
  granted nor unmanaged. Nobody asked, so it is a scheduling opportunity, not a
  failure.

`unmanaged` is excluded from both: the load IS drawing, just outside
arbitration, so the surplus was not wasted on it. Comfort loads are excluded
from the idle figure only.

This split came out of the real-data validation. Merged into one figure it read
75 % of all export "missed" on the reference installation, two thirds of it a
comfort heat pump idle because the house was comfortable — a number that would
have made a healthy arbiter look broken. Split, the arbiter's own miss is 3 %.
Both are documented as estimates everywhere they surface.

### 3.2 `src/energy/arbiter-metrics-store.ts`

Same shape and same contract as `ArbiterJournalStore`: prepared statements built
in the constructor, `INSERT OR REPLACE` writes, a boot-time purge, and every
method wrapped so a DB error is logged through pino and swallowed.

`upsertTick(rows)` takes **all** the rows of one tick and writes them inside a
single `db.transaction()` (see 3.4). Also `readRange(from, to)` and
`purgeOlderThan(days = 400)`.

### 3.3 `src/energy/arbiter-metrics-rollup.ts`

Scheduler and glue. On each hour-aligned tick, and once immediately at startup
(the startup run covers the whole journal retention, not just two days: after
an outage longer than a day those days are still in the raw journal and would
otherwise never be recovered):

1. compute local midnight for today and for yesterday (spec 061 rules);
2. read each day's decisions and surplus samples from the existing stores;
3. resolve the current load profiles from `EquipmentManager` and the two
   settings values from `SettingsManager`;
4. call `rollupDay` per day;
5. upsert both days in one transaction.

Hour alignment rather than a plain 24 h interval is the #618 lesson: an interval
drifts and a restart resets it, so a day boundary eventually falls in a gap.
Recomputing yesterday on every tick is what makes a restart across midnight a
non-event.

`ArbiterJournalStore` gains `rangeLatest()` so the cap in 3.4 is applied in SQL
rather than after loading everything. That is the only change to an existing
arbiter file, and it is purely additive: `range()` keeps its exact signature and
behaviour.

### 3.4 Bounded reads and flash budget

**Bounded reads.** Nothing bounds how many decisions a day can hold, and the
pathological case (an arbiter that flaps) is exactly the one this measurement exists
to measure. Each rollup reads at most `ROLLUP_ROW_CAP` (20 000) decision rows
**per day**, in one query per day rather than a single two-day query, and logs a
warning naming the day when the cap is hit. A truncated rollup is never silently
reported as complete. At the cap, one day's read is a few MB of transient
objects, freed as soon as `rollupDay` returns.

The read matters more for **event-loop latency** than for memory:
`better-sqlite3` is synchronous, so a capped read plus its reduction is tens of
milliseconds, once an hour, on a timer with no deadline. Splitting the two days
keeps each pause short.

**Flash.** The database runs in WAL mode with `synchronous` left at its SQLite
default (FULL), so every commit costs one fsync and writes whole 4 KB pages.
What wears flash is the number of commits, not the bytes in a row. A tick writes
about 12 load rows plus 2 home rows; issued in **one** transaction that is one
commit and one fsync per hour, roughly 12 KB of WAL, about 600 KB/day once the
checkpoint copy-back is counted, on the order of 200 MB/year. Issued
individually it would be 14 commits and 14 fsyncs per hour, about five times the
wear. The `CLAUDE.md` batch-write convention is a hard requirement here, not a
style note.

For scale, `arbiter_surplus_log` already performs 288 autocommit inserts a day
and the decision journal is of the same order, so this spec adds under 10 % of
Sowel's SQLite write volume, itself dwarfed by the per-minute InfluxDB writes.
The 400-day retention costs about 200-500 KB of database size and one `DELETE`
at boot. Note that the daily rollup is a _compression_: 400 days of aggregated
rows are far smaller than the 7 days of raw decisions that already exist.

If write volume ever needs cutting, the cadence is the knob: today every 4 hours
and yesterday once after midnight divides the writes by four, at the cost of
staler same-day metrics. Not done by default, because the hourly catch-up is
what makes a restart across a day boundary harmless.

**Out of scope, tracked as #694**: `src/core/database.ts` sets
`journal_mode = WAL` but never sets `synchronous`, which therefore stays FULL.
`synchronous = NORMAL` is the standard WAL recommendation and would cut fsyncs
across the whole application, far beyond this spec. It trades the last
transactions on a power loss (no corruption), so it is a deliberate durability
decision that does not belong in this change.

## 4. API

```
GET /api/v1/energy/arbiter/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD
```

- Same auth as the other `/api/v1/energy/*` routes.
- Defaults: `to` = today, `from` = `to - 29 days`. Range capped at 400 days.
- Querystring validated with a Fastify schema (the #452/#482 convention), plus
  a calendar round-trip in the handler for a well-shaped impossible date:
  `Date.parse("2026-02-30")` does not fail, it rolls over to March 2.
- The clamp is anchored on **today**, not on `to`. Anchoring on `to` pushes
  `from` forward for a far-future `to` and hides data that does exist.
- Returns `ArbiterMetricsResponse`. No data gives `{ from, to, home: [],
loads: [], estimates: [...] }` with a 200, never a 500.

No WebSocket event: this is historical data, polled on demand, not a live
signal.

## 5. Script

`scripts/energy/arbiter-metrics.ts`, following the conventions of that folder
(tsx-run, `--from` / `--to` flags, readable table output, a `README.md` entry).
It opens the SQLite file directly, so it works against a restored backup with no
running instance. Output: a totals block, a per-load breakdown with the
short-cycle rate, and an explicit "estimate" marker on
`idleClaimableExportWh`.

## 6. Files touched

| File                                       | Change                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| `migrations/025_arbiter_daily_metrics.sql` | new                                                       |
| `src/energy/arbiter-metrics.ts`            | new (pure)                                                |
| `src/energy/arbiter-metrics-store.ts`      | new                                                       |
| `src/energy/arbiter-metrics-rollup.ts`     | new                                                       |
| `src/energy/arbiter-journal-store.ts`      | optional `limit` on `range()` (additive)                  |
| `src/shared/types.ts`                      | three new interfaces                                      |
| `src/api/routes/energy.ts`                 | one new GET route                                         |
| `src/index.ts`                             | instantiate the store and the rollup, stop it on shutdown |
| `scripts/energy/arbiter-metrics.ts`        | new                                                       |
| `scripts/energy/README.md`                 | one entry                                                 |
| `src/energy/capacity-arbiter.ts`           | **not touched**                                           |
| `ui/`                                      | **not touched**                                           |
