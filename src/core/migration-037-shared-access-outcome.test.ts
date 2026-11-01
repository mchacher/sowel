/**
 * Spec 188 — migration 037 adds `outcome` / `outcome_expected` to
 * `shared_access_journal`.
 *
 * Every row written before it was written untracked, and must read as "not
 * tracked" (NULL), not as a pending press the guest page would wait on.
 */

import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? ".", "../../migrations");
const SUBJECT = "037_shared_access_outcome.sql";

function applyMigrationsBefore(db: Database.Database, file: string): void {
  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f < file)) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8"));
  }
}

let db: Database.Database;

describe("migration 037 — shared_access_journal.outcome", () => {
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

  it("keeps every existing row, untracked", () => {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, SUBJECT), "utf-8"));
    const rows = db
      .prepare(
        "SELECT kind, label, outcome, outcome_expected FROM shared_access_journal ORDER BY at",
      )
      .all();
    expect(rows).toEqual([
      { kind: "opened", label: "Plombier", outcome: null, outcome_expected: null },
      { kind: "refused", label: "Plombier", outcome: null, outcome_expected: null },
    ]);
  });

  it("stores an outcome and its expected movement on a new row", () => {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, SUBJECT), "utf-8"));
    db.prepare(
      `INSERT INTO shared_access_journal (at, label, kind, outcome, outcome_expected)
       VALUES (3, 'X', 'opened', 'pending', 'open')`,
    ).run();
    expect(
      db.prepare("SELECT outcome, outcome_expected FROM shared_access_journal WHERE at = 3").get(),
    ).toEqual({ outcome: "pending", outcome_expected: "open" });
  });
});
