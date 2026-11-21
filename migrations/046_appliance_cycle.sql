-- Spec 213 — per-appliance thresholds of the run state derived from power.
-- JSON { startW, endW, endDelayS }. NULL = the defaults (start above 15 W,
-- finished after 300 s below 10 W).
ALTER TABLE equipments ADD COLUMN appliance_cycle TEXT;
