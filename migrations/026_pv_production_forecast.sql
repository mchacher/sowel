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
