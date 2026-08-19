-- Issue #627 — per-equipment resolution mode for a momentary boolean order
-- trigger (e.g. a `gate` "command" button, which sends an empty value).
-- 'fixed' (default) always resolves to true, same as today. 'toggle'
-- resolves to the logical inverse of the device's last known value for that
-- order key instead, for relays that never report their own auto-off and
-- silently drop a repeated identical command.
ALTER TABLE equipments ADD COLUMN gate_trigger_mode TEXT NOT NULL DEFAULT 'fixed';
