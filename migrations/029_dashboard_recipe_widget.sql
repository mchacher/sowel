-- Spec 169 — a recipe package can declare a Dashboard tile, and a user can pin
-- an instance of such a recipe as a widget.
--
-- The widget type is constrained by a CHECK, and SQLite cannot alter one: the
-- only way to widen it is to recreate the table and copy the rows.
--
-- No `PRAGMA foreign_keys = off` around it, on purpose — and this is the part
-- worth reading before copying this migration elsewhere. The runner wraps every
-- migration in a transaction (`core/database.ts`), and inside a transaction
-- that pragma is a silent no-op: writing it would look like protection while
-- providing none. It is not needed here for two verifiable reasons:
--
--   1. no table references dashboard_widgets, so the DROP breaks no inbound
--      key, and the RENAME has no foreign clause anywhere to rewrite;
--   2. the outbound keys are re-declared on the new table, and every copied row
--      already satisfied them a moment ago in the old one.
--
-- A table that IS referenced by another would need a different approach.

CREATE TABLE dashboard_widgets_new (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('equipment', 'zone', 'recipe')),
  label TEXT,
  icon TEXT,
  equipment_id TEXT,
  zone_id TEXT,
  recipe_instance_id TEXT,
  -- Copied verbatim from 001, four values and all. It is narrower than the
  -- WidgetFamily union in types.ts ('water', 'pool', 'displays', 'ventilation'
  -- and 'power' are declared in TypeScript and rejected here), which is a real
  -- bug — and not this migration's. Fixing it silently inside a table recreate
  -- would bury it; it is reported on its own.
  family TEXT CHECK(family IN ('lights', 'shutters', 'heating', 'sensors')),
  display_order INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_id) REFERENCES equipments(id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE,
  FOREIGN KEY (recipe_instance_id) REFERENCES recipe_instances(id) ON DELETE CASCADE
);

INSERT INTO dashboard_widgets_new
  (id, type, label, icon, equipment_id, zone_id, family, display_order, config, created_at)
SELECT
  id, type, label, icon, equipment_id, zone_id, family, display_order, config, created_at
FROM dashboard_widgets;

DROP TABLE dashboard_widgets;

ALTER TABLE dashboard_widgets_new RENAME TO dashboard_widgets;
