#!/usr/bin/env node
// Spec 151 FR7 — break-glass MFA reset. Clears TOTP secret, backup codes, and
// trusted devices for one account directly in SQLite. Covers the case an
// admin locks themselves out (lost TOTP device + backup codes) with no other
// admin available to help via Administration → Utilisateurs.
//
// Usage (from the host, container running under docker compose):
//   docker exec sowel node scripts/auth/reset-mfa.mjs <username>
//
// Requires the same host/container access already assumed by
// scripts/logs/fetch-logs.py and the backup-restore tooling.

import Database from "better-sqlite3";
import { resolve } from "node:path";

const username = process.argv[2];
if (!username) {
  console.error("Usage: node scripts/auth/reset-mfa.mjs <username>");
  process.exit(1);
}

const dbPath = resolve(process.env.SQLITE_PATH ?? "./data/sowel.db");
const db = new Database(dbPath);

try {
  const user = db.prepare("SELECT id, username FROM users WHERE username = ?").get(username);
  if (!user) {
    console.error(`No user named "${username}" found in ${dbPath}`);
    process.exit(1);
  }

  const result = db.transaction((userId) => {
    const totp = db.prepare("DELETE FROM user_mfa_totp WHERE user_id = ?").run(userId);
    const codes = db.prepare("DELETE FROM user_mfa_backup_codes WHERE user_id = ?").run(userId);
    const devices = db.prepare("DELETE FROM mfa_trusted_devices WHERE user_id = ?").run(userId);
    return {
      totp: totp.changes,
      backupCodes: codes.changes,
      trustedDevices: devices.changes,
    };
  })(user.id);

  console.log(`MFA reset for "${username}" (${user.id}):`);
  console.log(`  TOTP secret removed: ${result.totp > 0 ? "yes" : "was not enrolled"}`);
  console.log(`  Backup codes removed: ${result.backupCodes}`);
  console.log(`  Trusted devices removed: ${result.trustedDevices}`);
  console.log("The account can now log in with just its password.");
} finally {
  db.close();
}
