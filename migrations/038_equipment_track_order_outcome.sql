-- Spec 188 O10 — whether an equipment's orders are followed to their outcome.
--
-- NULL means the default for its type: on for `gate` and `door`, off for every
-- other type. 1 / 0 is the admin's explicit choice, kept across type changes.
ALTER TABLE equipments ADD COLUMN track_order_outcome INTEGER;
