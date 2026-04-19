-- Spec 081: Pool equipment support.
--
-- Adds:
--  1. pool_runtime_state: tracks daily cumulative ON-time per pool_pump equipment.
--  2. order_bindings.category_override: per-binding semantic override so that
--     an equipment type (e.g. pool_pump) can re-tag a device order's category
--     without touching the underlying device definition. Read via
--     COALESCE(category_override, device_orders.category).

CREATE TABLE IF NOT EXISTS pool_runtime_state (
  equipment_id TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  current_state TEXT NOT NULL,                   -- ON | OFF | UNKNOWN
  state_since TEXT NOT NULL,                     -- ISO 8601
  cumulative_seconds_today INTEGER NOT NULL DEFAULT 0,
  last_reset_date TEXT NOT NULL                  -- YYYY-MM-DD local
);

ALTER TABLE order_bindings ADD COLUMN category_override TEXT;
