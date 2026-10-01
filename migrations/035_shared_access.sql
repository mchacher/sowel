-- Spec 181 — shared access: let someone who is not a Sowel user open a gate,
-- for a while, with a code or a link.
--
-- Nothing is added to `equipments` (review [1]): a gate carries no
-- configuration of its own. What a press sends is on the access–gate link, and
-- whether a gate is armed is a row in `shared_access_disarmed`. Every link to an
-- equipment cascades on its deletion, which is R2.6's cleanup.

-- R9 — what a plugin's accesses open. The owner decides, the plugin only picks.
CREATE TABLE shared_access_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  plugin_id     TEXT,                          -- the one plugin it is granted to; NULL = none
  is_default    INTEGER NOT NULL DEFAULT 0,    -- R9.33: exactly one, never deleted
  valid_from    INTEGER,                       -- epoch ms; NULL/NULL = « Tout le temps »
  valid_until   INTEGER,
  time_windows  TEXT NOT NULL DEFAULT '[]',    -- JSON [{from,to}] 'HH:MM'; [] = « Toute la journée »
  with_code     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

-- A profile's gates. A table rather than a JSON column so that deleting the
-- equipment cascades here too (R2.6), like it does on an access.
CREATE TABLE shared_access_profile_gates (
  profile_id    TEXT NOT NULL REFERENCES shared_access_profiles(id) ON DELETE CASCADE,
  equipment_id  TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  value         TEXT,                          -- JSON; NULL = what the gate's button sends (R2.5)
  PRIMARY KEY (profile_id, equipment_id)
);

CREATE TABLE shared_accesses (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('manual', 'external')),
  label           TEXT NOT NULL,
  code            TEXT,                        -- clear, optional, nulled 7 days after the end (R3.8)
  link_version    INTEGER NOT NULL DEFAULT 1,  -- bumped by « Change the code »
  link_token_hash TEXT NOT NULL UNIQUE,        -- SHA-256 of the link's own token (R3.8)
  valid_from      INTEGER,                     -- epoch ms, in force; NULL = open-ended
  valid_until     INTEGER,
  source_plugin   TEXT,                        -- external only
  external_id     TEXT,
  profile_id      TEXT REFERENCES shared_access_profiles(id) ON DELETE SET NULL,
  source_from     INTEGER,                     -- the source's dates, external only
  source_until    INTEGER,
  early_open_at   INTEGER,                     -- owner's widening of an external access
  extended_until  INTEGER,
  time_windows    TEXT NOT NULL DEFAULT '[]',
  suspended_at    INTEGER,
  revoked_at      INTEGER,
  created_at      INTEGER NOT NULL,
  created_by      TEXT NOT NULL,
  last_used_at    INTEGER,
  use_count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source_plugin, external_id)
);
-- R3.8: a code identifies its access on its own.
CREATE UNIQUE INDEX idx_shared_accesses_code ON shared_accesses(code) WHERE code IS NOT NULL;

CREATE TABLE shared_access_gates (
  access_id     TEXT NOT NULL REFERENCES shared_accesses(id) ON DELETE CASCADE,
  equipment_id  TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  value         TEXT,                          -- JSON; NULL = what the gate's button sends (R2.5)
  PRIMARY KEY (access_id, equipment_id)
);

-- R2.4: a row = that gate refuses every press.
CREATE TABLE shared_access_disarmed (
  equipment_id  TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  disarmed_at   INTEGER NOT NULL,
  disarmed_by   TEXT NOT NULL
);

CREATE TABLE shared_access_phones (
  id            TEXT PRIMARY KEY,
  access_id     TEXT NOT NULL REFERENCES shared_accesses(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT NOT NULL
);

-- No foreign keys: « who came in that night » outlives the access (R3.11).
CREATE TABLE shared_access_journal (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            INTEGER NOT NULL,
  access_id     TEXT,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL,                 -- opened, refused, enrolled, created, ...
  reason        TEXT,
  actor         TEXT,
  equipment_id  TEXT,
  phone_id      TEXT                           -- R5.22: « Vos commandes » are this phone's own
);
CREATE INDEX idx_sa_journal_at ON shared_access_journal(at);
CREATE INDEX idx_sa_journal_access ON shared_access_journal(access_id, at);
CREATE INDEX idx_sa_journal_phone ON shared_access_journal(phone_id, at);
