-- Issue #535 — the timeline painted "on outside arbitration" for loads that
-- were OFF: a `suspended` entry said nothing about the load's actual on/off
-- state at suspension time. Record it (0/1) so the timeline can map an
-- OFF-triggered suspension to idle. NULL = unknown (legacy rows).
ALTER TABLE arbiter_decision_log ADD COLUMN running INTEGER;
