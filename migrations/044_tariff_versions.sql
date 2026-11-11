-- Spec 202 — dated electricity prices.
--
-- A version is valid from its start date (a local day) until the next one.
-- The first version has no start date: it is open backwards, so every past
-- point has a price. Euros are computed at read time from these rows; the
-- prices kept in the `energy.tariff` setting are only read once, to create the
-- first version at startup.
CREATE TABLE tariff_versions (
  id             TEXT PRIMARY KEY,
  start_date     TEXT,
  price_hp       REAL NOT NULL,
  price_hc       REAL NOT NULL,
  fixed_fee_year REAL,
  kva            REAL,
  origin         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- One version per start date, and a single version without one (UNIQUE alone
-- would let several NULLs in).
CREATE UNIQUE INDEX idx_tariff_versions_start ON tariff_versions (COALESCE(start_date, ''));

-- The arbiter gain is now booked in Wh, peak and off-peak, and priced at read
-- time. `avoided_eur` keeps what was booked in euros before this migration.
ALTER TABLE arbiter_daily_gain ADD COLUMN solar_hp_wh REAL NOT NULL DEFAULT 0;
ALTER TABLE arbiter_daily_gain ADD COLUMN solar_hc_wh REAL NOT NULL DEFAULT 0;
