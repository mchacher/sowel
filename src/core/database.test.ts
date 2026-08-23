import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.js";

// Issue #694 — the pragmas `openDatabase()` sets are a deliberate durability
// and wear decision, and nothing pinned them until now. They must be asserted
// against a REAL on-disk database: an in-memory database silently ignores
// `journal_mode = WAL` (it reports "memory"), so a test built on `:memory:`
// would pass no matter what the code did.

describe("openDatabase — pragmas", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sowel-db-test-"));
    dbPath = join(dir, "sowel.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("opens in WAL mode", () => {
    const db = openDatabase(dbPath);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    db.close();
  });

  it("sets synchronous to NORMAL, not the SQLite default of FULL", () => {
    // 0 = OFF, 1 = NORMAL, 2 = FULL. FULL fsyncs on every commit, and the hot
    // path (one autocommit UPDATE per device data point) has no batching, so
    // that default meant one fsync per sensor message. See the comment in
    // database.ts for the trade-off this accepts.
    const db = openDatabase(dbPath);
    expect(db.pragma("synchronous", { simple: true })).toBe(1);
    db.close();
  });

  it("enforces foreign keys", () => {
    // Behavioural, not a guard on the pragma line: better-sqlite3 compiles
    // SQLITE_DEFAULT_FOREIGN_KEYS=1, so removing `db.pragma("foreign_keys =
    // ON")` would leave this green. What matters is that FK enforcement holds,
    // however it is obtained — so assert a violation is actually rejected.
    const db = openDatabase(dbPath);
    db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
    db.exec("CREATE TABLE child (id INTEGER PRIMARY KEY, p INTEGER REFERENCES parent(id))");
    expect(() => db.prepare("INSERT INTO child (id, p) VALUES (1, 999)").run()).toThrow();
    db.close();
  });

  it("re-opens an existing WAL database without changing its pragmas", () => {
    // The subtle case behind #694: an EXISTING WAL file inherits
    // SQLITE_DEFAULT_WAL_SYNCHRONOUS at open, a brand-new one does not. Both
    // paths must land on NORMAL now that we set it explicitly, otherwise the
    // first process lifetime of a fresh install differs from every later one.
    const first = openDatabase(dbPath);
    first.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, v TEXT)");
    first.prepare("INSERT INTO probe (id, v) VALUES (1, 'written')").run();
    first.close();

    const second = openDatabase(dbPath);
    expect(second.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(second.pragma("synchronous", { simple: true })).toBe(1);
    const row = second.prepare("SELECT v FROM probe WHERE id = 1").get() as { v: string };
    expect(row.v).toBe("written");
    second.close();
  });

  it("creates the data directory when it does not exist", () => {
    const nested = join(dir, "deep", "nested", "sowel.db");
    const db = openDatabase(nested);
    expect(existsSync(nested)).toBe(true);
    db.close();
  });
});
