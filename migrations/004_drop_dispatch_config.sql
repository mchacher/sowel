-- Legacy columns dispatch_config, mqtt_set_topic, payload_key are no longer used.
-- Cannot DROP COLUMN in SQLite without table rebuild, and table rebuild
-- inside a transaction would CASCADE-delete order_bindings.
-- Solution: leave columns in place, they are simply ignored by the code.
-- A future major version can do a clean schema rebuild.
SELECT 1;
