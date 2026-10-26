/**
 * Spec 188 — migration 037 adds `receipt` to `shared_access_journal`.
 *
 * Every row written before it was written without a receipt, and must read as
 * "no receipt expected" (NULL), not as a pending one the guest page would wait on.
 */

import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? ".", "../../migrations");
const SUBJECT = "037_shared_access_receipt.sql";

function applyMigrationsBefore(db: Database.Database, file: string): void {
  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f < file)) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8"));
  }
}

let db: Database.Database;

describe("migration 037 — shared_access_journal.receipt", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrationsBefore(db, SUBJECT);
    const insert = db.prepare(
      `INSERT INTO shared_access_journal (at, access_id, label, kind, equipment_id)
       VALUES (?, 'a1', 'Plombier', ?, 'gate')`,
    );
    insert.run(1, "opened");
    insert.run(2, "refused");
  });
  afterEach(() => db.close());

  it("keeps every existing row, with no receipt", () => {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, SUBJECT), "utf-8"));
    const rows = db
      .prepare("SELECT kind, label, receipt FROM shared_access_journal ORDER BY at")
      .all() as { kind: string; label: string; receipt: string | null }[];
    expect(rows).toEqual([
      { kind: "opened", label: "Plombier", receipt: null },
      { kind: "refused", label: "Plombier", receipt: null },
    ]);
  });

  it("stores a receipt on a new row", () => {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, SUBJECT), "utf-8"));
    db.prepare(
      `INSERT INTO shared_access_journal (at, label, kind, receipt) VALUES (3, 'X', 'opened', 'pending')`,
    ).run();
    expect(
      (
        db.prepare("SELECT receipt FROM shared_access_journal WHERE at = 3").get() as {
          receipt: string;
        }
      ).receipt,
    ).toBe("pending");
  });
});
