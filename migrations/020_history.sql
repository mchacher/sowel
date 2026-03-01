-- V0.13: InfluxDB History — add historize flag to data_bindings
-- NULL = use category/alias default, 1 = force ON, 0 = force OFF

ALTER TABLE data_bindings ADD COLUMN historize INTEGER DEFAULT NULL;
