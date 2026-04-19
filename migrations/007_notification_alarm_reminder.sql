-- Spec 083: Alarm reminder at notification publisher level.
--
-- Adds alarm_reminder_minutes to notification_publishers. When > 0, the
-- publish service re-sends the message every N minutes while a raised
-- system alarm stays unresolved. 0 (default) = disabled — unchanged
-- behaviour from before this migration.

ALTER TABLE notification_publishers ADD COLUMN alarm_reminder_minutes INTEGER NOT NULL DEFAULT 0;
