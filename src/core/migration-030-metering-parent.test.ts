/**
 * Spec 173 — migration 030 adds `metering_parent_id` to `equipments`.
 *
 * An ADD COLUMN is the cheap migration shape, but this one carries a
 * self-referencing foreign key with ON DELETE SET NULL, and it runs on
 * databases full of equipments people depend on. These check the three things
 * that could go wrong: existing rows losing data, the default not meaning
 * "counted nowhere else", and a deleted parent leaving a dangling id behind.
 */

import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? ".", "../../migrations");
const SUBJECT = "030_metering_parent.sql";

function applyMigrationsBefore(db: Database.Database, file: string): void {
  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f < file)) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8"));
  }
}

function applyMigration(db: Database.Database, file: string): void {
  const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
  db.transaction(() => db.exec(sql))();
}

let db: Database.Database;

describe("migration 030 — metering_parent_id", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrationsBefore(db, SUBJECT);
    db.prepare("INSERT INTO zones (id, name) VALUES ('z1', 'Gîte')").run();
    db.prepare(
      "INSERT INTO equipments (id, name, zone_id, type) VALUES ('gite', 'ConsommationGite', 'z1', 'energy_meter')",
    ).run();
    db.prepare(
      "INSERT INTO equipments (id, name, zone_id, type) VALUES ('ce', 'ConsommationChauffeEau', 'z1', 'energy_meter')",
    ).run();
  });
  afterEach(() => db.close());

  it("keeps every existing equipment, with no parent declared", () => {
    applyMigration(db, SUBJECT);
    const rows = db
      .prepare("SELECT id, name, metering_parent_id FROM equipments ORDER BY id")
      .all() as { id: string; name: string; metering_parent_id: string | null }[];
    expect(rows.map((r) => r.id)).toEqual(["ce", "gite"]);
    expect(rows.map((r) => r.name)).toEqual(["ConsommationChauffeEau", "ConsommationGite"]);
    // NULL is the honest default: nothing about an existing install changes.
    expect(rows.every((r) => r.metering_parent_id === null)).toBe(true);
  });

  it("accepts a declaration and refuses one pointing nowhere", () => {
    applyMigration(db, SUBJECT);
    db.prepare("UPDATE equipments SET metering_parent_id = 'gite' WHERE id = 'ce'").run();
    expect(
      (
        db.prepare("SELECT metering_parent_id AS p FROM equipments WHERE id = 'ce'").get() as {
          p: string;
        }
      ).p,
    ).toBe("gite");

    expect(() =>
      db.prepare("UPDATE equipments SET metering_parent_id = 'ghost' WHERE id = 'ce'").run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("frees the children when the parent meter is deleted", () => {
    applyMigration(db, SUBJECT);
    db.prepare("UPDATE equipments SET metering_parent_id = 'gite' WHERE id = 'ce'").run();
    db.prepare("DELETE FROM equipments WHERE id = 'gite'").run();

    const row = db
      .prepare("SELECT metering_parent_id AS p FROM equipments WHERE id = 'ce'")
      .get() as {
      p: string | null;
    };
    // ON DELETE SET NULL: the heater keeps measuring, it just stops being
    // declared inside anything.
    expect(row.p).toBeNull();
  });

  it("indexes the column, since the breakdown resolves children on every query", () => {
    applyMigration(db, SUBJECT);
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'equipments'")
      .all() as { name: string }[];
    expect(idx.some((i) => i.name === "idx_equipments_metering_parent")).toBe(true);
  });
});
