/**
 * Spec 169 — migration 029 recreates `dashboard_widgets` to widen a CHECK
 * constraint, which SQLite cannot alter in place.
 *
 * A table recreate is the one migration shape that can silently lose a user's
 * data, so it is tested the way it actually runs in production: on a database
 * that already holds rows, **inside a transaction** (`runMigrations` wraps every
 * file in one), with `foreign_keys = ON`. That combination is exactly what makes
 * `PRAGMA foreign_keys = off` a no-op here — the migration deliberately does not
 * use it, and these tests are what back that decision.
 */

import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? ".", "../../migrations");
const SUBJECT = "029_dashboard_recipe_widget.sql";

/** Every migration ordered before the one under test — derived, never listed. */
function applyMigrationsBefore(db: Database.Database, file: string): void {
  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f < file)) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8"));
  }
}

/** Run one migration the way the production runner does: in a transaction. */
function applyMigration(db: Database.Database, file: string): void {
  const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
  db.transaction(() => db.exec(sql))();
}

let db: Database.Database;

describe("migration 029 — dashboard_widgets recreate", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrationsBefore(db, SUBJECT);

    db.prepare("INSERT INTO zones (id, name) VALUES ('z1', 'Salon')").run();
    db.prepare(
      "INSERT INTO equipments (id, name, type, zone_id) VALUES ('e1', 'Lampe', 'light', 'z1')",
    ).run();
    db.prepare(
      "INSERT INTO recipe_instances (id, recipe_id, params) VALUES ('ri1', 'delivery-gate', '{}')",
    ).run();
    // A widget of each pre-existing type, with every optional column filled:
    // the copy has to carry them all, not just the ones the UI happens to read.
    db.prepare(
      `INSERT INTO dashboard_widgets (id, type, label, icon, equipment_id, family, display_order, config, created_at)
       VALUES ('w1', 'equipment', 'Ma lampe', 'light_bulb', 'e1', NULL, 3, '{"visibleBindings":["state"]}', '2026-01-02 03:04:05')`,
    ).run();
    db.prepare(
      `INSERT INTO dashboard_widgets (id, type, zone_id, family, display_order)
       VALUES ('w2', 'zone', 'z1', 'lights', 7)`,
    ).run();
  });

  afterEach(() => db.close());

  it("carries every existing row across, column for column", () => {
    const before = db.prepare("SELECT * FROM dashboard_widgets ORDER BY id").all() as Record<
      string,
      unknown
    >[];

    applyMigration(db, SUBJECT);

    const after = db
      .prepare(
        "SELECT id, type, label, icon, equipment_id, zone_id, family, display_order, config, created_at FROM dashboard_widgets ORDER BY id",
      )
      .all() as Record<string, unknown>[];

    expect(after).toEqual(before);
  });

  it("accepts the new type, and still rejects an unknown one", () => {
    applyMigration(db, SUBJECT);

    db.prepare(
      "INSERT INTO dashboard_widgets (id, type, recipe_instance_id, display_order) VALUES ('w3', 'recipe', 'ri1', 9)",
    ).run();
    expect(
      db.prepare("SELECT recipe_instance_id FROM dashboard_widgets WHERE id = 'w3'").get(),
    ).toEqual({ recipe_instance_id: "ri1" });

    expect(() =>
      db
        .prepare("INSERT INTO dashboard_widgets (id, type, display_order) VALUES ('w4', 'nope', 0)")
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it("keeps the two original cascades alive after the recreate", () => {
    applyMigration(db, SUBJECT);

    db.prepare("DELETE FROM equipments WHERE id = 'e1'").run();
    expect(db.prepare("SELECT id FROM dashboard_widgets WHERE id = 'w1'").get()).toBeUndefined();

    db.prepare("DELETE FROM zones WHERE id = 'z1'").run();
    expect(db.prepare("SELECT id FROM dashboard_widgets WHERE id = 'w2'").get()).toBeUndefined();
  });

  it("cascades the new one too", () => {
    applyMigration(db, SUBJECT);
    db.prepare(
      "INSERT INTO dashboard_widgets (id, type, recipe_instance_id, display_order) VALUES ('w3', 'recipe', 'ri1', 9)",
    ).run();

    db.prepare("DELETE FROM recipe_instances WHERE id = 'ri1'").run();

    expect(db.prepare("SELECT id FROM dashboard_widgets WHERE id = 'w3'").get()).toBeUndefined();
  });

  it("refuses a widget pointing at an instance that does not exist", () => {
    applyMigration(db, SUBJECT);
    expect(() =>
      db
        .prepare(
          "INSERT INTO dashboard_widgets (id, type, recipe_instance_id, display_order) VALUES ('w5', 'recipe', 'ghost', 0)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
