CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('equipment', 'zone')),
  label TEXT,
  icon TEXT,
  equipment_id TEXT,
  zone_id TEXT,
  family TEXT CHECK(family IN ('lights', 'shutters', 'heating', 'sensors')),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_id) REFERENCES equipments(id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);
