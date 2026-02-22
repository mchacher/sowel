-- Modes (global operating profiles)
CREATE TABLE IF NOT EXISTS modes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Event triggers (button press, data change)
CREATE TABLE IF NOT EXISTS mode_event_triggers (
  id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL REFERENCES modes(id) ON DELETE CASCADE,
  equipment_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  value TEXT NOT NULL
);

-- Zone mode impacts (what a mode does in each zone)
CREATE TABLE IF NOT EXISTS zone_mode_impacts (
  id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL REFERENCES modes(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  actions TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_mode_impacts_unique
  ON zone_mode_impacts(mode_id, zone_id);

-- Calendar profiles (Travail, Vacances)
CREATE TABLE IF NOT EXISTS calendar_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Calendar time slots
CREATE TABLE IF NOT EXISTS calendar_slots (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES calendar_profiles(id) ON DELETE CASCADE,
  days TEXT NOT NULL,
  time TEXT NOT NULL,
  mode_ids TEXT NOT NULL
);

-- Seed default profiles
INSERT OR IGNORE INTO calendar_profiles (id, name, built_in) VALUES ('travail', 'Travail', 1);
INSERT OR IGNORE INTO calendar_profiles (id, name, built_in) VALUES ('vacances', 'Vacances', 1);
