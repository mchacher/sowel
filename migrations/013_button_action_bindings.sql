-- Button Action Bindings (universal controller for buttons/switches)
-- Replaces mode_event_triggers with a more flexible system
CREATE TABLE IF NOT EXISTS button_action_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  action_value TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migrate existing mode event triggers to button action bindings
INSERT OR IGNORE INTO button_action_bindings (id, equipment_id, action_value, effect_type, config)
  SELECT id, equipment_id, value, 'mode_activate', json_object('modeId', mode_id)
  FROM mode_event_triggers;

-- Drop the old triggers table
DROP TABLE IF EXISTS mode_event_triggers;
