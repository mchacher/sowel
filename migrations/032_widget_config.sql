-- Add config column (JSON) to dashboard_widgets for per-widget settings
ALTER TABLE dashboard_widgets ADD COLUMN config TEXT;
