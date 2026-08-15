import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const dbPath = process.argv[2];
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const migrationsDir = resolve("migrations");
for (const f of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  db.exec(readFileSync(resolve(migrationsDir, f), "utf-8"));
}

const userId = randomUUID();
db.prepare(
  `INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
).run(userId, "smoketest", "Smoke Test", "dummy-hash", "admin");

db.prepare(
  `INSERT INTO user_mfa_totp (user_id, secret, confirmed_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
).run(userId, "JBSWY3DPEHPK3PXP");
db.prepare(`INSERT INTO user_mfa_backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)`).run(
  randomUUID(),
  userId,
  "deadbeef",
);
db.prepare(
  `INSERT INTO mfa_trusted_devices (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))`,
).run(randomUUID(), userId, "cafebabe");

console.log("Seeded user", userId);
db.close();
