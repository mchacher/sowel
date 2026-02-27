-- Migration 014: Convert calendar_slots.mode_ids (string[]) to mode_actions ({modeId, action}[])
-- Existing mode_ids entries are migrated as "on" actions (backward compatible)

ALTER TABLE calendar_slots ADD COLUMN mode_actions TEXT;

-- Migrate existing data: ["id1","id2"] → [{"modeId":"id1","action":"on"},{"modeId":"id2","action":"on"}]
UPDATE calendar_slots
SET mode_actions = (
  SELECT json_group_array(json_object('modeId', value, 'action', 'on'))
  FROM json_each(calendar_slots.mode_ids)
)
WHERE mode_ids IS NOT NULL AND mode_ids != '[]';

-- Empty arrays stay empty
UPDATE calendar_slots SET mode_actions = '[]' WHERE mode_actions IS NULL;
