-- Spec 208 — equipment families.
--
-- Every equipment type has a fixed family in the UI (lighting, openings,
-- climate, water, energy, sensors) or none. A switch is the exception: the
-- same plug drives a radiator in one room and a Wi-Fi router in another, so
-- the installation says which family it belongs to. NULL = no family, the
-- switch sits with the plugs, which is how every existing switch reads.
ALTER TABLE equipments ADD COLUMN family TEXT;
