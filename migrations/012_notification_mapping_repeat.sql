-- Spec 128 — per-mapping re-notification (repeat).
-- repeat_ms:  NULL = no re-notification; > 0 = interval between reminders (ms).
-- repeat_max: NULL = unlimited (only meaningful with repeat_ms); >= 1 = max reminders
--             after the initial notification.
ALTER TABLE notification_publisher_mappings ADD COLUMN repeat_ms INTEGER;
ALTER TABLE notification_publisher_mappings ADD COLUMN repeat_max INTEGER;
