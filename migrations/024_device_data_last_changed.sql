-- Add last_changed column: only updated when the value actually changes.
-- Initialized to last_updated for existing rows.
ALTER TABLE device_data ADD COLUMN last_changed TEXT;
UPDATE device_data SET last_changed = last_updated;
