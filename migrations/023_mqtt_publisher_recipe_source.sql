-- Add 'recipe' to mqtt_publisher_mappings source_type CHECK constraint
-- SQLite does not support ALTER CONSTRAINT, so we recreate the table

CREATE TABLE mqtt_publisher_mappings_new (
  id TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL REFERENCES mqtt_publishers(id) ON DELETE CASCADE,
  publish_key TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('equipment', 'zone', 'recipe')),
  source_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publisher_id, publish_key)
);

INSERT INTO mqtt_publisher_mappings_new
  SELECT id, publisher_id, publish_key, source_type, source_id, source_key, created_at
  FROM mqtt_publisher_mappings;

DROP TABLE mqtt_publisher_mappings;

ALTER TABLE mqtt_publisher_mappings_new RENAME TO mqtt_publisher_mappings;
