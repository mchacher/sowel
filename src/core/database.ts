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

  // Issue #694 — pin `synchronous` rather than inherit it.
  //
  // The effective value today is already NORMAL, but only by accident of a
  // dependency: better-sqlite3 compiles SQLite with
  // SQLITE_DEFAULT_WAL_SYNCHRONOUS=1, and SQLite applies that to any database
  // ALREADY in WAL mode at open time. A brand-new file is different — it is
  // created in `delete` mode, takes the ordinary default (FULL), and switching
  // it to WAL afterwards does not re-apply the WAL default. So a fresh install
  // ran its first process lifetime at FULL, and every boot after that at
  // NORMAL, with nothing in this repo expressing the intent either way.
  //
  // Stating it here makes the choice ours instead of a compile flag's: a
  // better-sqlite3 bump that drops or flips that define would otherwise
  // silently move production to one fsync per commit. `database.test.ts` pins
  // it.
  //
  // What NORMAL means under WAL: commits do not fsync, the sync happens at
  // checkpoint. A power loss or an OS crash can lose transactions committed
  // since the last checkpoint — with the default wal_autocheckpoint of 1000
  // pages that is up to ~4 MB of WAL, so potentially many minutes of writes,
  // not seconds (Linux writeback makes the realistic loss much smaller than
  // that guaranteed bound). It CANNOT corrupt the database, and recovery is
  // prefix-consistent: you can never keep transaction N+1 having lost N. A
  // process crash or a container restart loses nothing, since the host page
  // cache survives both — but a VM hard-stop is a guest power loss, not a
  // restart.
  //
  // Note this pragma changes WHEN SQLite fsyncs, never how many pages it
  // writes. It is not a write-amplification fix; batching the per-message
  // writes in DeviceManager is (see the issue).
  db.pragma("synchronous = NORMAL");

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
