-- Fix: migration 011 table recreation failed (foreign_keys=ON blocks DROP with FK refs).
-- Recreate devices, device_data, device_orders with nullable MQTT columns.
-- Must also handle data_bindings and order_bindings which reference these tables.

-- 1. Backup all affected tables into temp tables

CREATE TABLE IF NOT EXISTS _bak_devices AS SELECT * FROM devices;
CREATE TABLE IF NOT EXISTS _bak_device_data AS SELECT * FROM device_data;
CREATE TABLE IF NOT EXISTS _bak_device_orders AS SELECT * FROM device_orders;
CREATE TABLE IF NOT EXISTS _bak_data_bindings AS SELECT * FROM data_bindings;
CREATE TABLE IF NOT EXISTS _bak_order_bindings AS SELECT * FROM order_bindings;

-- 2. Drop tables in reverse dependency order
DROP TABLE IF EXISTS order_bindings;
DROP TABLE IF EXISTS data_bindings;
DROP TABLE IF EXISTS device_orders;
DROP TABLE IF EXISTS device_data;
DROP TABLE IF EXISTS devices;

-- 3. Recreate with correct schema (mqtt columns nullable)

CREATE TABLE devices (
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

CREATE TABLE device_data (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generic',
  unit TEXT,
  value TEXT,
  last_updated DATETIME,
  UNIQUE(device_id, key)
);

CREATE TABLE device_orders (
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

CREATE TABLE data_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_data_id TEXT NOT NULL REFERENCES device_data(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias)
);

CREATE TABLE order_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_order_id TEXT NOT NULL REFERENCES device_orders(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias)
);

-- 4. Restore data
INSERT INTO devices SELECT * FROM _bak_devices;
INSERT INTO device_data SELECT * FROM _bak_device_data;
INSERT INTO device_orders SELECT * FROM _bak_device_orders;
INSERT INTO data_bindings SELECT * FROM _bak_data_bindings;
INSERT INTO order_bindings SELECT * FROM _bak_order_bindings;

-- 5. Cleanup backup tables
DROP TABLE _bak_devices;
DROP TABLE _bak_device_data;
DROP TABLE _bak_device_orders;
DROP TABLE _bak_data_bindings;
DROP TABLE _bak_order_bindings;

-- 6. Recreate indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_integration_source
  ON devices(integration_id, source_device_id);
