-- Spec 158 — daily rollup of the arbiter's own behaviour.
--
-- arbiter_decision_log and arbiter_surplus_log keep 7 days, which makes any
-- retrospective study of the arbiter impossible past a week. These two tables
-- hold the aggregated per-day figures for 400 days, so a change to the
-- arbitration logic can be compared against a real "before".
--
-- Written by ArbiterMetricsRollup on an hour-aligned timer, recomputing today
-- and yesterday every tick: the upsert is idempotent per key, and today's row
-- is partial by construction until the first tick after midnight completes it.

CREATE TABLE IF NOT EXISTS arbiter_daily_load_metrics (
  day           TEXT NOT NULL,    -- local YYYY-MM-DD
  equipment_id  TEXT NOT NULL,
  grants        INTEGER NOT NULL DEFAULT 0,
  revokes       INTEGER NOT NULL DEFAULT 0,
  -- Grants revoked in less than (minOnS + releaseHoldS): the "regret" metric.
  short_cycles  INTEGER NOT NULL DEFAULT 0,
  granted_s     INTEGER NOT NULL DEFAULT 0,
  pending_s     INTEGER NOT NULL DEFAULT 0,
  unmanaged_s   INTEGER NOT NULL DEFAULT 0,
  suspended_s   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, equipment_id)
);

CREATE TABLE IF NOT EXISTS arbiter_daily_home_metrics (
  day                       TEXT PRIMARY KEY, -- local YYYY-MM-DD
  export_wh                 REAL NOT NULL DEFAULT 0,
  import_wh                 REAL NOT NULL DEFAULT 0,
  -- Estimate: export accumulated while a declared load sat idle and the
  -- surplus covered its needW. 5-min sampling, profile read at rollup time.
  idle_claimable_export_wh  REAL NOT NULL DEFAULT 0,
  -- Surplus samples the day actually had (~288 for a full day). A low count
  -- means the instance was down, not that the day was quiet.
  samples                   INTEGER NOT NULL DEFAULT 0
);
