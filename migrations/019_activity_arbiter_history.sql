-- Spec 147 — persist the activity feed (spec 101) and the arbiter decision
-- journal (spec 140) across restarts. Both were in-memory ring buffers, lost on
-- every container restart/update (issue #494). Mirrors the audit_log pattern
-- (spec 113): bounded, timestamped, append-only, purged at boot (7-day
-- retention). Live arbiter control state (claims, suspensions, surplus) is NOT
-- persisted — it is rebuilt from live events by design.

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
