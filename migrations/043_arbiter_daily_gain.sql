-- Spec 200 — the arbiter's gain, per local day and per load.
--
-- The arbiter gain meter samples the arbiter every minute and books the solar
-- energy used by the loads it switched on, priced at the tariff of that minute.
-- It cannot be recomputed later (the journal and the surplus series are purged
-- after 7 days), so it accumulates here and is part of the backup.
--
-- No foreign key on equipment_id: a removed load keeps its history, and the
-- restore order of the backup does not matter. About five rows a day, no purge.
CREATE TABLE IF NOT EXISTS arbiter_daily_gain (
  day          TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  solar_wh     REAL NOT NULL,
  avoided_eur  REAL NOT NULL,
  PRIMARY KEY (day, equipment_id)
);
