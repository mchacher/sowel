CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  manifest TEXT NOT NULL
);
