import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerPushRoutes } from "./push.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";
import { PushSubscriptionManager } from "../../notifications/push-subscription-manager.js";
import { createMigratedTestDb } from "../../test-helpers/migrations.js";
import { createLogger } from "../../core/logger.js";

// Spec 199 — the per-device routes, against a real manager on a migrated DB:
// the list carries the delivery fields, and rename / delete by id act on the
// caller's own subscriptions only (404 otherwise).

const logger = createLogger("silent").logger;

let db: Database.Database;
let manager: PushSubscriptionManager;
let app: FastifyInstance;

function insertUser(id: string): void {
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)`,
  ).run(id, `user-${id}`, `User ${id}`, "x");
}

beforeEach(async () => {
  db = createMigratedTestDb();
  insertUser("u1");
  insertUser("u2");
  manager = new PushSubscriptionManager(db, logger);
  app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  app.addHook("onRequest", async (request) => {
    request.auth = { userId: "u1", role: "standard" };
  });
  registerPushRoutes(app, {
    pushSubscriptionManager: manager,
    vapidKeys: { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.c" },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

const mine = () => manager.upsert("u1", { endpoint: "https://push/mine", p256dh: "k", auth: "a" });
const theirs = () =>
  manager.upsert("u2", { endpoint: "https://push/theirs", p256dh: "k", auth: "a" });

describe("push device routes (spec 199)", () => {
  it("lists the caller's devices with the delivery result", async () => {
    const s = mine();
    theirs();
    manager.recordFailure(s.id, "500 boom");
    const res = await app.inject({ method: "GET", url: "/api/v1/push/subscriptions" });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: s.id, consecutiveFailures: 1, lastError: "500 boom" });
    expect(list[0].lastSentAt).toBeTruthy();
  });

  it("renames an own device", async () => {
    const s = mine();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/push/subscriptions/${s.id}`,
      payload: { label: "Marc's iPhone" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBe("Marc's iPhone");
  });

  it("clears the name with null", async () => {
    const s = mine();
    manager.rename(s.id, "u1", "Old");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/push/subscriptions/${s.id}`,
      payload: { label: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBeUndefined();
  });

  it("404s a rename of another user's device", async () => {
    const s = theirs();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/push/subscriptions/${s.id}`,
      payload: { label: "Mine now" },
    });
    expect(res.statusCode).toBe(404);
    expect(manager.listByUser("u2")[0].label).toBeUndefined();
  });

  it("400s a name that is too long", async () => {
    const s = mine();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/push/subscriptions/${s.id}`,
      payload: { label: "x".repeat(61) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("deletes an own device by id", async () => {
    const s = mine();
    const res = await app.inject({ method: "DELETE", url: `/api/v1/push/subscriptions/${s.id}` });
    expect(res.statusCode).toBe(204);
    expect(manager.listAll()).toHaveLength(0);
  });

  it("404s a delete of another user's device, and keeps it", async () => {
    const s = theirs();
    const res = await app.inject({ method: "DELETE", url: `/api/v1/push/subscriptions/${s.id}` });
    expect(res.statusCode).toBe(404);
    expect(manager.listAll()).toHaveLength(1);
  });

  it("keeps the endpoint-based DELETE", async () => {
    mine();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/push/subscriptions",
      payload: { endpoint: "https://push/mine" },
    });
    expect(res.statusCode).toBe(204);
    expect(manager.listAll()).toHaveLength(0);
  });
});
