-- Spec 083: Pool heat pump support.
--
-- pool_water_temp_state: caches the last "active" water temperature sample per
-- pool_heat_pump equipment. A sample is considered active when either the
-- bound `filtration_state` alias is ON, or (when not bound) the bound `mode`
-- alias is anything other than "OFF". The cache is used to expose
-- `effective_water_temperature` even while the heat pump (or filtration) is
-- not running, up to a 24h freshness window after which the value drops to
-- null.

CREATE TABLE IF NOT EXISTS pool_water_temp_state (
  equipment_id TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  last_active_value REAL,                       -- last temperature sample °C
  last_active_ts TEXT                           -- ISO 8601 of last active sample
);
