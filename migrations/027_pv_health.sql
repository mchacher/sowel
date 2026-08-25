-- Spec 162 — tell the household when the panels stop performing.
--
-- The modelled side of the comparison already exists: `pv_forecast_sample`
-- carries measured production paired with the plane-of-array irradiance that
-- produced it. What it does not carry is how much of that irradiance arrived as
-- beam rather than scattered, which is what decides whether an hour is clear
-- enough to judge on. Measured on the reference installation, restricting to
-- hours above 0.75 takes the day-to-day noise from 9.5 % to 4.3 %.
--
-- Nullable on purpose: rows written before this migration have no fraction and
-- simply never qualify, which the day-level minimum already handles.
ALTER TABLE pv_forecast_sample ADD COLUMN direct_fraction REAL;

CREATE TABLE IF NOT EXISTS pv_health_day (
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,
  ratio        REAL NOT NULL,
  hours        INTEGER NOT NULL,
  measured_wh  REAL NOT NULL,
  modelled_wh  REAL NOT NULL,
  PRIMARY KEY (equipment_id, day)
);

CREATE INDEX IF NOT EXISTS idx_pv_health_day_equipment
  ON pv_health_day (equipment_id, day DESC);
