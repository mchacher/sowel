-- Notification Publishers
CREATE TABLE IF NOT EXISTS notification_publishers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT 'telegram',
  channel_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_publisher_mappings (
  id TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL REFERENCES notification_publishers(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  throttle_ms INTEGER NOT NULL DEFAULT 300000,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(publisher_id, source_type, source_id, source_key)
);
