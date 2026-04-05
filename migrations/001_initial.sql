-- Sowel 1.0.0 — Initial schema
-- Consolidated from 34 incremental migrations

CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  mqtt_base_topic TEXT,
  mqtt_name TEXT,
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  ieee_address TEXT,
  zone_id TEXT,
  source TEXT NOT NULL DEFAULT 'zigbee2mqtt',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen DATETIME,
  raw_expose JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  integration_id TEXT NOT NULL DEFAULT '',
  source_device_id TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_integration_source
  ON devices(integration_id, source_device_id);

CREATE TABLE IF NOT EXISTS device_data (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generic',
  unit TEXT,
  value TEXT,
  last_updated DATETIME,
  last_changed TEXT,
  UNIQUE(device_id, key)
);

CREATE TABLE IF NOT EXISTS device_orders (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  mqtt_set_topic TEXT,
  payload_key TEXT,
  min_value REAL,
  max_value REAL,
  enum_values JSON,
  unit TEXT,
  dispatch_config JSON NOT NULL DEFAULT '{}',
  UNIQUE(device_id, key)
);

CREATE TABLE IF NOT EXISTS equipments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'generic',
  icon TEXT,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS data_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_data_id TEXT NOT NULL REFERENCES device_data(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  historize INTEGER DEFAULT NULL,
  UNIQUE(equipment_id, alias)
);

CREATE TABLE IF NOT EXISTS order_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_order_id TEXT NOT NULL REFERENCES device_orders(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias)
);

CREATE TABLE IF NOT EXISTS recipe_instances (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  params JSON NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipe_state (
  instance_id TEXT NOT NULL REFERENCES recipe_instances(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (instance_id, key)
);

CREATE TABLE IF NOT EXISTS recipe_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL REFERENCES recipe_instances(id) ON DELETE CASCADE,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  message TEXT NOT NULL,
  level TEXT DEFAULT 'info'
);

CREATE INDEX IF NOT EXISTS idx_recipe_log_instance ON recipe_log(instance_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'standard',
  preferences JSON DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  last_used_at DATETIME,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS modes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS zone_mode_impacts (
  id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL REFERENCES modes(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  actions TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_mode_impacts_unique
  ON zone_mode_impacts(mode_id, zone_id);

CREATE TABLE IF NOT EXISTS calendar_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed built-in calendar profiles
INSERT OR IGNORE INTO calendar_profiles (id, name, built_in) VALUES ('travail', 'Travail', 1);
INSERT OR IGNORE INTO calendar_profiles (id, name, built_in) VALUES ('vacances', 'Vacances', 1);

CREATE TABLE IF NOT EXISTS calendar_slots (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES calendar_profiles(id) ON DELETE CASCADE,
  days TEXT NOT NULL,
  time TEXT NOT NULL,
  mode_ids TEXT NOT NULL,
  mode_actions TEXT
);

CREATE TABLE IF NOT EXISTS button_action_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  action_value TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chart_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mqtt_brokers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  username TEXT,
  password TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mqtt_publishers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  broker_id TEXT REFERENCES mqtt_brokers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mqtt_publisher_mappings (
  id TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL REFERENCES mqtt_publishers(id) ON DELETE CASCADE,
  publish_key TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('equipment', 'zone', 'recipe')),
  source_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publisher_id, publish_key)
);

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

CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('equipment', 'zone')),
  label TEXT,
  icon TEXT,
  equipment_id TEXT,
  zone_id TEXT,
  family TEXT CHECK(family IN ('lights', 'shutters', 'heating', 'sensors')),
  display_order INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_id) REFERENCES equipments(id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  manifest TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'integration'
);
