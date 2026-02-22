-- V0.10a: Integration Plugin Architecture
-- Generalize MQTT-specific columns to support multiple integration types.
-- Old columns (mqtt_base_topic, mqtt_name, mqtt_set_topic, payload_key) are kept
-- for backward compatibility but replaced by integration_id, source_device_id, dispatch_config.

-- 1. Add generic columns to devices
ALTER TABLE devices ADD COLUMN integration_id TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN source_device_id TEXT NOT NULL DEFAULT '';

-- 2. Migrate existing data: mqtt_base_topic -> integration_id, mqtt_name -> source_device_id
UPDATE devices SET integration_id = mqtt_base_topic, source_device_id = mqtt_name;

-- 3. Create unique index on new columns
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_integration_source
  ON devices(integration_id, source_device_id);

-- 4. Add dispatch_config column to device_orders
ALTER TABLE device_orders ADD COLUMN dispatch_config JSON NOT NULL DEFAULT '{}';

-- 5. Migrate existing order data into dispatch_config
UPDATE device_orders SET dispatch_config = json_object('topic', mqtt_set_topic, 'payloadKey', payload_key);

-- 6. Relax NOT NULL on deprecated columns for new non-MQTT devices.
-- SQLite doesn't support ALTER COLUMN, so we recreate the tables.

-- 6a. Devices: mqtt_base_topic and mqtt_name become nullable
CREATE TABLE devices_new (
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
INSERT INTO devices_new SELECT
  id, mqtt_base_topic, mqtt_name, name, manufacturer, model, ieee_address,
  zone_id, source, status, last_seen, raw_expose, created_at, updated_at,
  integration_id, source_device_id
FROM devices;
DROP TABLE devices;
ALTER TABLE devices_new RENAME TO devices;
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_integration_source
  ON devices(integration_id, source_device_id);

-- 6b. Device orders: mqtt_set_topic and payload_key become nullable
CREATE TABLE device_orders_new (
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
INSERT INTO device_orders_new SELECT
  id, device_id, key, type, mqtt_set_topic, payload_key,
  min_value, max_value, enum_values, unit, dispatch_config
FROM device_orders;
DROP TABLE device_orders;
ALTER TABLE device_orders_new RENAME TO device_orders;

-- 7. Migrate settings: mqtt.* and z2m.* -> integration.zigbee2mqtt.*
INSERT OR REPLACE INTO settings (key, value, updated_at)
  SELECT 'integration.zigbee2mqtt.' || CASE key
    WHEN 'mqtt.url' THEN 'mqtt_url'
    WHEN 'mqtt.username' THEN 'mqtt_username'
    WHEN 'mqtt.password' THEN 'mqtt_password'
    WHEN 'mqtt.clientId' THEN 'mqtt_client_id'
    WHEN 'z2m.baseTopic' THEN 'base_topic'
    ELSE key
  END, value, updated_at
  FROM settings WHERE key IN ('mqtt.url', 'mqtt.username', 'mqtt.password', 'mqtt.clientId', 'z2m.baseTopic');
