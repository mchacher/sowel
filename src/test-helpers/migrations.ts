import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolve the migrations directory relative to this helper (not the calling
// test), so the path is stable regardless of the test file's depth in src/.
const MIGRATIONS_DIR = resolve(import.meta.dirname ?? ".", "../../migrations");

/**
 * Apply every migration in `migrations/` to the given database, in the same
 * order as production (`runMigrations` in src/core/database.ts: all `.sql`
 * files, sorted alphabetically). Tests must not hardcode a subset — that list
 * silently drifts from the real schema as migrations are added.
 */
export function applyMigrations(db: Database.Database): void {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8"));
  }
}

/**
 * Create an in-memory SQLite database with foreign keys enabled and the full
 * migration set applied. The standard starting point for DB-backed tests.
 */
export function createMigratedTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}
