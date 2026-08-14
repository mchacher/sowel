-- Spec 148 (Phase B) — persist the arbiter's signed surplus/deficit series so the
-- Energy → arbitrage timeline survives restarts and can be read over a window
-- (up to 48h). `available_w` is signed: > 0 surplus, < 0 déficit (grid import).
-- 5-min samples, 7-day retention purged at boot.
CREATE TABLE IF NOT EXISTS arbiter_surplus_log (
  at          INTEGER PRIMARY KEY, -- epoch ms
  available_w REAL NOT NULL        -- signed watts
);
