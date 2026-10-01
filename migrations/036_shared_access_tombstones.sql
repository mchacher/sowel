-- Spec 181 R9.34 — a stay the owner revoked and deleted stays revoked.
--
-- Deleting an access also deleted its (plugin, externalId) key, so the next
-- replay of the plugin's feed created a fresh access with a working code. The
-- tombstone keeps the key: a later upsert of that stay answers `revoked` and
-- creates nothing. Purged with the journal, after a year.
CREATE TABLE shared_access_tombstones (
  plugin_id   TEXT NOT NULL,
  external_id TEXT NOT NULL,
  deleted_at  INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, external_id)
);

-- The two ceilings of R4.13 count openings on every press, over up to 50 000
-- journal lines. The per-access index of 035 lacked `kind`.
CREATE INDEX idx_sa_journal_gate ON shared_access_journal (equipment_id, kind, at);
DROP INDEX idx_sa_journal_access;
CREATE INDEX idx_sa_journal_access ON shared_access_journal (access_id, kind, at);
