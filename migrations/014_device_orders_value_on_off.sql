-- Wire representations for boolean orders (spec: issue #360).
-- Declared by the integration at discovery time (e.g. Z2M binary expose
-- value_on/value_off). JSON-encoded so string and boolean forms round-trip.
ALTER TABLE device_orders ADD COLUMN value_on TEXT;
ALTER TABLE device_orders ADD COLUMN value_off TEXT;
