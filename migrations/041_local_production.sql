-- Spec 195 (issue #1116) — a submeter that can see local production.
--
-- A power-only clamp can sit upstream of a small generator: a solar panel on
-- the pool house roof wired behind the pool meter. When the panel produces more
-- than the pool draws, the clamp reads negative watts. Spec 091 integrates
-- |P| (built for clamps wired backwards), so that production is counted as the
-- pool's consumption, and never as production.
--
-- One boolean lets the installation say what is true of it: "negative power on
-- this meter is production". Everything existing gets 0 — read as today.
ALTER TABLE equipments ADD COLUMN local_production INTEGER NOT NULL DEFAULT 0;

-- The production half of a flagged meter's minute, pending its flush — the
-- consumption half already lives in `pending_wh`.
ALTER TABLE submeter_integrator_state ADD COLUMN pending_production_wh REAL NOT NULL DEFAULT 0;
