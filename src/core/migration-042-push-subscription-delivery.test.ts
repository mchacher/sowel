/**
 * Spec 199 — migration 042 adds a label and the last delivery result to
 * `push_subscriptions`. Existing subscriptions survive, unnamed, with no
 * delivery recorded and no failure counted.
 */

import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? ".", "../../migrations");
const SUBJECT = "042_push_subscription_delivery.sql";

function applyMigrationsBefore(db: Database.Database, file: string): void {
  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f < file)) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8"));
  }
}

let db: Database.Database;

describe("migration 042 — push_subscriptions delivery columns", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrationsBefore(db, SUBJECT);
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash) VALUES ('u1', 'u1', 'U1', 'x')`,
    ).run();
    db.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
       VALUES ('s1', 'u1', 'https://push/1', 'k', 'a', 'iPhone')`,
    ).run();
  });
  afterEach(() => db.close());

  it("keeps existing subscriptions, unnamed and with no failure", () => {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, SUBJECT), "utf-8"));
    const row = db
      .prepare(
        `SELECT id, user_agent, label, last_sent_at, last_success_at, last_error, consecutive_failures
         FROM push_subscriptions`,
      )
      .get();
    expect(row).toEqual({
      id: "s1",
      user_agent: "iPhone",
      label: null,
      last_sent_at: null,
      last_success_at: null,
      last_error: null,
      consecutive_failures: 0,
    });
  });
});
