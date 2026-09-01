-- Spec 173 — a meter that sits inside another one.
--
-- The by-usage breakdown assumes its submeters are disjoint (`other = total −
-- Σ submeters`). Real switchboards nest: a gîte clamp and, downstream of it, a
-- water-heater clamp. Both enrol as submeters (#523 made enrolment a blocklist),
-- so the heater is counted twice and the residual is deflated by as much.
--
-- One nullable self-reference lets the installation say what is true of it:
-- "my consumption is already counted by that meter". Everything existing gets
-- NULL, which means "counted nowhere else" — the behaviour it has today.
--
-- ADD COLUMN carrying a REFERENCES clause is legal in SQLite because the
-- default is NULL: no table rebuild is needed, unlike migration 029.
ALTER TABLE equipments ADD COLUMN metering_parent_id TEXT
  REFERENCES equipments(id) ON DELETE SET NULL;

-- The breakdown resolves children per parent on every query.
CREATE INDEX IF NOT EXISTS idx_equipments_metering_parent
  ON equipments(metering_parent_id);
