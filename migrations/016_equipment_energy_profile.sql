-- Spec 140 — energy capacity arbiter.
-- Flexible-load declaration per equipment, JSON (EnergyLoadProfile in
-- src/shared/types.ts). NULL = not profiled = not claimable.
ALTER TABLE equipments ADD COLUMN energy_profile TEXT;
