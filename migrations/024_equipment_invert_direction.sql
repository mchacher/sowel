-- Spec 154 (issue #614) — per-equipment invert of shutter-family command
-- direction. When set, EquipmentManager.executeOrder flips shutter_move
-- OPEN<->CLOSE and set_shutter_position -> 100-value for this equipment, so a
-- motor wired the opposite way (a store banne / RTS awning with no bridge-side
-- invert) moves the right way. Command-only: reported position stays raw.
-- 0 = off (default) so every existing equipment keeps its current behavior.
ALTER TABLE equipments ADD COLUMN invert_direction INTEGER NOT NULL DEFAULT 0;
