-- Spec 134 — daily min/max temperature envelope for weather equipments.
-- One row per (equipment, temperature binding alias), always holding the
-- current day's envelope; midnight rollover overwrites in place. Long-term
-- history stays in InfluxDB — this table only survives restarts.
CREATE TABLE IF NOT EXISTS weather_temp_extremes (
  equipment_id TEXT NOT NULL,
  alias        TEXT NOT NULL,
  day          TEXT NOT NULL,
  min_value    REAL NOT NULL,
  max_value    REAL NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (equipment_id, alias)
);
