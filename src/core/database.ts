import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Logger } from "./logger.js";

/**
 * Opens the SQLite database at `dbPath`.
 *
 * The `parentLogger` parameter is optional to support the early boot phase
 * (before `createLogger()` is called — see timezone detection in index.ts).
 * When omitted, log messages are silently suppressed.
 */
export function openDatabase(dbPath: string, parentLogger?: Logger): Database.Database {
  const logger = parentLogger?.child({ module: "database" });

  // Ensure data directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    logger?.info({ dir }, "Created data directory");
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  logger?.info({ path: dbPath }, "SQLite database opened");

  return db;
}

/**
 * SQLite CURRENT_TIMESTAMP stores UTC without timezone marker (e.g. "2026-02-20 14:30:00").
 * JavaScript parses that as local time, causing offset errors.
 * This helper appends 'Z' so Date correctly interprets it as UTC.
 */
export function toISOUtc(sqliteTimestamp: string): string;
export function toISOUtc(sqliteTimestamp: string | null): string | null;
export function toISOUtc(sqliteTimestamp: string | null): string | null {
  if (!sqliteTimestamp) return null;
  return sqliteTimestamp.endsWith("Z") ? sqliteTimestamp : `${sqliteTimestamp}Z`;
}

export function runMigrations(
  db: Database.Database,
  migrationsDir: string,
  parentLogger: Logger,
): void {
  const logger = parentLogger.child({ module: "migrations" });

  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Get already applied migrations
  const applied = new Set(
    db
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  // Read migration files, sorted alphabetically
  if (!existsSync(migrationsDir)) {
    logger.warn({ dir: migrationsDir }, "Migrations directory does not exist");
    return;
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      logger.debug({ migration: file }, "Already applied, skipping");
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf-8");

    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    });

    runMigration();
    logger.info({ migration: file }, "Migration applied");
  }
}
