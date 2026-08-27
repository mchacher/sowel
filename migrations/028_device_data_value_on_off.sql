-- Wire representations for boolean data points, mirroring 014 on device_orders.
-- Integrations already declare them at discovery (e.g. a Z2M binary expose
-- carries value_on/value_off, "ON"/"OFF" or "LOCK"/"UNLOCK"); until now they
-- were kept for the outgoing order and dropped on the incoming reading, which
-- left normalizeValue guessing from a hard-coded vocabulary and flagging
-- everything else. JSON-encoded so string and boolean forms round-trip.
ALTER TABLE device_data ADD COLUMN value_on TEXT;
ALTER TABLE device_data ADD COLUMN value_off TEXT;
