-- Simplify equipment types: merge motion_sensor and contact_sensor into sensor
UPDATE equipments SET type = 'sensor' WHERE type IN ('motion_sensor', 'contact_sensor');

-- Remove unused types from any existing data (shouldn't exist, but just in case)
-- thermostat, lock, alarm, media_player, camera, generic are removed
