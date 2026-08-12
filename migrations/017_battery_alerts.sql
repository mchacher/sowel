-- Spec 143 — low battery alerts.
-- Devices declare how they are powered at discovery; 'unknown' keeps the
-- heuristic fallback for integrations that never report it.
ALTER TABLE devices ADD COLUMN power_source TEXT NOT NULL DEFAULT 'unknown';

-- One row per battery device data currently under the threshold. Deleted when
-- the battery recovers. `last_notified_at` drives the weekly reminder and is
-- persisted so a restart neither re-notifies nor restarts the week.
-- No foreign key on device_data(id): a cascade delete would drop the row
-- without letting the monitor emit system.alarm.resolved, leaving a ghost entry
-- in the UI banner. The sweep reconciles orphans instead.
CREATE TABLE IF NOT EXISTS battery_alerts (
  device_data_id   TEXT PRIMARY KEY,
  device_id        TEXT NOT NULL,
  device_name      TEXT NOT NULL,
  value            TEXT NOT NULL,
  raised_at        TEXT NOT NULL,
  last_notified_at TEXT NOT NULL
);
