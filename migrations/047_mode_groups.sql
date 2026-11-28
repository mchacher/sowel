-- Spec 219 — mode groups. A mode may carry a group name; within a group,
-- activating a mode deactivates the others. A column rather than a table: a
-- group has no attribute of its own and must vanish with its last mode.
-- `activated_at` tells which mode of a group was activated last when an active
-- mode is moved into a group that already has one; modes active before this
-- migration take their last update as an approximation.
ALTER TABLE modes ADD COLUMN group_name TEXT;
ALTER TABLE modes ADD COLUMN activated_at TEXT;
UPDATE modes SET activated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) WHERE active = 1;
