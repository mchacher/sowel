-- MQTT Brokers: allow multiple broker connections for publishers
CREATE TABLE IF NOT EXISTS mqtt_brokers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  username TEXT,
  password TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add broker_id to mqtt_publishers (nullable for migration — existing publishers need reconfiguration)
ALTER TABLE mqtt_publishers ADD COLUMN broker_id TEXT REFERENCES mqtt_brokers(id);
