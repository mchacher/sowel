-- Spec 152: Equipment solar command channel.
--
-- Adds data_bindings.category_override, mirroring the order_bindings column
-- introduced in migration 006. A per-binding semantic override lets an
-- equipment re-tag a device data's category without touching the device
-- definition, read via COALESCE(category_override, device_data.category).
--
-- This is what lets a solar state-feedback binding carry category
-- `solar_state` (distinct from the main on/off `light_state`) so the two
-- channels resolve independently under category-first resolution, and the
-- solar state charts as its own Analyse "states" series.

ALTER TABLE data_bindings ADD COLUMN category_override TEXT;
