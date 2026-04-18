-- Add enum_values column to device_data, mirroring device_orders.
-- Allows storing possible values for enum-type data properties (e.g. button action values).
ALTER TABLE device_data ADD COLUMN enum_values JSON;
