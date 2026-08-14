-- Spec 146 — optional confirmation before actuating a sensitive opening.
-- Per-equipment opt-in (gate v1), enforced on the mobile dashboard.
-- 0 = off (default) so every existing equipment stays unguarded.
ALTER TABLE equipments ADD COLUMN require_confirmation INTEGER NOT NULL DEFAULT 0;
