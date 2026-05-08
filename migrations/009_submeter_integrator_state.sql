CREATE TABLE IF NOT EXISTS submeter_integrator_state (
  equipment_id    TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  pending_wh      REAL NOT NULL DEFAULT 0,
  last_sample_at  TEXT,
  last_sample_w   REAL,
  last_write_at   TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
