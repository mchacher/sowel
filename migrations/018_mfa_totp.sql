-- Spec 149 — Two-factor authentication (TOTP + backup codes)

CREATE TABLE IF NOT EXISTS user_mfa_totp (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  confirmed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_mfa_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user ON user_mfa_backup_codes(user_id);

CREATE TABLE IF NOT EXISTS mfa_trusted_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mfa_trusted_devices_user ON mfa_trusted_devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_trusted_devices_hash ON mfa_trusted_devices(token_hash);
