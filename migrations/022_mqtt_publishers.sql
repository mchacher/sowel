-- MQTT Publishers: generic key/value MQTT output
CREATE TABLE IF NOT EXISTS mqtt_publishers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mqtt_publisher_mappings (
  id TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL REFERENCES mqtt_publishers(id) ON DELETE CASCADE,
  publish_key TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('equipment', 'zone')),
  source_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publisher_id, publish_key)
);
