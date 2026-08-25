-- Spec 160 — PV production forecast.
--
-- The declared array geometry lives on the equipment, exactly as the flexible
-- load declaration of spec 140 does: a JSON column whose presence is what
-- enables the feature.
ALTER TABLE equipments ADD COLUMN solar_profile TEXT;

-- The fitted model, one row per production equipment.
--
-- `fitted_peak_wc` is what makes a declared capacity change detectable without
-- a detector: a profile saved with a different total is the signal to
-- re-estimate the gain, leaving the hourly shape on its slow window.
CREATE TABLE IF NOT EXISTS pv_forecast_model (
  equipment_id   TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  gain           REAL NOT NULL,
  shape          TEXT NOT NULL,
  fitted_at      TEXT NOT NULL,
  samples        INTEGER NOT NULL,
  fitted_peak_wc REAL NOT NULL,
  gain_reset_at  TEXT
);

-- Training samples, collected as they happen.
--
-- The fit needs production paired with the plane-of-array irradiance that
-- produced it. Production is in InfluxDB, but past irradiance is nowhere: a
-- weather plugin publishes a forward-looking series and overwrites it at every
-- poll. So each closed hour is recorded here instead, which also keeps the fit
-- independent of InfluxDB being up.
--
-- One row per equipment per hour. A 45-day window of daylight hours is roughly
-- 600 rows.
CREATE TABLE IF NOT EXISTS pv_forecast_sample (
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  at           TEXT NOT NULL,   -- UTC ISO, start of the hour
  hour_local   INTEGER NOT NULL,
  poa          REAL NOT NULL,
  temp_c       REAL NOT NULL,
  watts        REAL NOT NULL,
  PRIMARY KEY (equipment_id, at)
);

CREATE INDEX IF NOT EXISTS idx_pv_sample_at ON pv_forecast_sample(equipment_id, at DESC);
