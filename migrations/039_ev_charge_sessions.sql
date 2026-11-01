-- Spec 191 — EV charge sessions and charging cost per vehicle.
--
-- A session is one plug-in on one charger. Its energy is the charger's meter;
-- its grid HP / grid HC / solar shares and its cost are accumulated live by
-- 5-minute windows (`est_*`, the car served last by the sun) and scaled to the
-- meter on read. The cost is frozen at the prices in force when each window
-- closed. `evidence` keeps what each vehicle reported during the session, so an
-- attribution still pending survives a restart.
CREATE TABLE ev_charge_sessions (
  id TEXT PRIMARY KEY,
  charger_id TEXT NOT NULL,
  charger_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  grace_until TEXT,
  energy_wh REAL NOT NULL DEFAULT 0,
  est_car_wh REAL NOT NULL DEFAULT 0,
  est_grid_hp_wh REAL NOT NULL DEFAULT 0,
  est_grid_hc_wh REAL NOT NULL DEFAULT 0,
  est_cost_hp_eur REAL,
  est_cost_hc_eur REAL,
  vehicle_id TEXT,
  vehicle_name TEXT,
  vehicle_deleted INTEGER NOT NULL DEFAULT 0,
  attribution TEXT NOT NULL DEFAULT 'pending'
    CHECK (attribution IN ('pending', 'vehicle', 'unattributed', 'other')),
  attribution_source TEXT CHECK (attribution_source IN ('auto', 'manual')),
  attribution_reason TEXT,
  battery_start REAL,
  battery_end REAL,
  evidence TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_ev_sessions_charger ON ev_charge_sessions (charger_id, started_at);
CREATE INDEX idx_ev_sessions_vehicle ON ev_charge_sessions (vehicle_id, started_at);

-- Driving consumption per vehicle and local day: km of legs with no charge on
-- the way, and the battery points used over them (cost per 100 km).
CREATE TABLE ev_vehicle_daily_driving (
  vehicle_id TEXT NOT NULL,
  day TEXT NOT NULL,
  km_total REAL NOT NULL DEFAULT 0,
  km_measured REAL NOT NULL DEFAULT 0,
  battery_drop REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (vehicle_id, day)
);

-- The open driving leg of each vehicle, so a leg survives a restart.
CREATE TABLE ev_vehicle_leg_state (
  vehicle_id TEXT PRIMARY KEY,
  mileage_km REAL NOT NULL,
  battery REAL,
  min_battery REAL,
  charged INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);

-- A plug-in hybrid shows no cost per 100 km. Everything existing gets 0.
ALTER TABLE equipments ADD COLUMN plug_in_hybrid INTEGER NOT NULL DEFAULT 0;
