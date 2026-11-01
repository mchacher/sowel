-- Spec 193 — a charger's usual vehicle: breaks a tie when several cars could
-- have charged. A plain column, as plug_in_hybrid (spec 191); cleared when
-- the vehicle is removed.
ALTER TABLE equipments ADD COLUMN usual_vehicle_id TEXT;
