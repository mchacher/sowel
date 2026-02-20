-- ============================================================
-- V0.3: Rename equipment types for consistency
-- light → light_onoff, dimmer → light_dimmable, color_light → light_color
-- ============================================================

UPDATE equipments SET type = 'light_onoff' WHERE type = 'light';
UPDATE equipments SET type = 'light_dimmable' WHERE type = 'dimmer';
UPDATE equipments SET type = 'light_color' WHERE type = 'color_light';
