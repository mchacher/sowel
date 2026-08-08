-- Spec 136 — Personal plugin sources.
-- plugin_sources: GitHub repos added by an admin as personal plugin sources.
-- plugins.source: which distribution path installed the package.
-- plugins.pinned_sha256: TOFU-pinned tarball hash for personal packages.

CREATE TABLE IF NOT EXISTS plugin_sources (
  repo TEXT PRIMARY KEY,
  added_at TEXT NOT NULL
);

ALTER TABLE plugins ADD COLUMN source TEXT NOT NULL DEFAULT 'registry';
ALTER TABLE plugins ADD COLUMN pinned_sha256 TEXT;
