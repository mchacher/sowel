/**
 * Characterization tests for the dashboard widget routes (#597, #482 Lot C).
 *
 * Written BEFORE the schema conversion and kept afterwards. The routes had no
 * test of their own, and the conversion's whole claim is "zero behavioural
 * regression", which is only worth anything if the behaviour was written down
 * first. Every expectation here was produced by running against the
 * hand-rolled implementation.
 *
 * The status codes are the part to read carefully. This route answers 400, not
 * 404, when a referenced equipment or zone does not exist, and the conversion
 * does not move it: #482 converts shape checks, it does not renumber answers a
 * client may already depend on.
 */

import Fastify from "fastify";
import Database from "better-sqlite3";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { registerDashboardRoutes } from "./dashboard.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";
import { applyMigrations } from "../../test-helpers/migrations.js";
import type { UserRole } from "../../shared/types.js";

let db: Database.Database;

function seedFixtures(): void {
  db.prepare("INSERT INTO zones (id, name) VALUES ('z1', 'Salon')").run();
  db.prepare(
    "INSERT INTO equipments (id, name, type, zone_id) VALUES ('e1', 'Lampe', 'light', 'z1')",
  ).run();
}

async function buildApp(opts: { authed?: boolean; role?: UserRole } = {}) {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  if (opts.authed !== false) {
    app.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role: opts.role ?? "admin" };
    });
  }
  registerDashboardRoutes(app, { db });
  await app.ready();
  return app;
}

const WIDGETS = "/api/v1/dashboard/widgets";

describe("dashboard widget routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedFixtures();
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
    db.close();
  });

  describe("POST /widgets — the create body is conditional on `type`", () => {
    it("creates an equipment widget", async () => {
      app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "equipment", equipmentId: "e1", label: "Lampe salon" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; type: string; equipmentId: string; label: string };
      expect(body.type).toBe("equipment");
      expect(body.equipmentId).toBe("e1");
      expect(body.label).toBe("Lampe salon");
    });

    it("creates a zone widget", async () => {
      app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "zone", zoneId: "z1", family: "lights" },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { family: string }).family).toBe("lights");
    });

    it("assigns display_order incrementally", async () => {
      app = await buildApp();
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: "POST",
          url: WIDGETS,
          payload: { type: "equipment", equipmentId: "e1" },
        });
      }
      const res = await app.inject({ method: "GET", url: WIDGETS });
      expect((res.json() as { displayOrder: number }[]).map((w) => w.displayOrder)).toEqual([
        0, 1, 2,
      ]);
    });

    // Reject matrix. Every one of these is a 400 with an { error } body.
    const rejects: [string, unknown][] = [
      ["no body at all", undefined],
      ["missing type", { equipmentId: "e1" }],
      ["unknown type", { type: "widget", equipmentId: "e1" }],
      ["type is not a string", { type: 1 }],
      ["equipment without equipmentId", { type: "equipment" }],
      ["equipment with an unknown equipmentId", { type: "equipment", equipmentId: "nope" }],
      ["zone without zoneId", { type: "zone", family: "lights" }],
      ["zone without family", { type: "zone", zoneId: "z1" }],
      ["zone with an unknown family", { type: "zone", zoneId: "z1", family: "curtains" }],
      ["zone with an unknown zoneId", { type: "zone", zoneId: "nope", family: "lights" }],
    ];

    for (const [name, payload] of rejects) {
      it(`400s on ${name}`, async () => {
        app = await buildApp();
        const res = await app.inject({ method: "POST", url: WIDGETS, payload: payload as never });
        expect(res.statusCode).toBe(400);
        expect(typeof (res.json() as { error: unknown }).error).toBe("string");
      });
    }

    it("still ignores unknown fields, as it always did", async () => {
      // additionalProperties is left at its default on purpose: rejecting them
      // would be a behaviour change dressed up as validation.
      app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "equipment", equipmentId: "e1", nonsense: true },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as Record<string, unknown>).nonsense).toBeUndefined();
    });

    it("403s a non-admin, and does so BEFORE looking at the body", async () => {
      // The precedence is the point: a non-admin sending nonsense must still
      // learn it is not allowed, not that its nonsense was malformed.
      app = await buildApp({ role: "standard" });
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "not-a-type" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("PATCH /widgets/:id", () => {
    async function createWidget(): Promise<string> {
      const res = await app!.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "equipment", equipmentId: "e1" },
      });
      return (res.json() as { id: string }).id;
    }

    it("updates label, icon and config", async () => {
      app = await buildApp();
      const id = await createWidget();
      const res = await app.inject({
        method: "PATCH",
        url: `${WIDGETS}/${id}`,
        payload: { label: "New", icon: "lamp", config: { showPower: true } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { label: string; icon: string; config: { showPower: boolean } };
      expect(body.label).toBe("New");
      expect(body.icon).toBe("lamp");
      expect(body.config).toEqual({ showPower: true });
    });

    it("clears a field when null is sent", async () => {
      app = await buildApp();
      const id = await createWidget();
      await app.inject({ method: "PATCH", url: `${WIDGETS}/${id}`, payload: { label: "x" } });
      const res = await app.inject({
        method: "PATCH",
        url: `${WIDGETS}/${id}`,
        payload: { label: null },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { label?: string }).label).toBeUndefined();
    });

    it("returns the widget unchanged when the body carries nothing to update", async () => {
      app = await buildApp();
      const id = await createWidget();
      const res = await app.inject({ method: "PATCH", url: `${WIDGETS}/${id}`, payload: {} });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { id: string }).id).toBe(id);
    });

    it("404s an unknown id", async () => {
      app = await buildApp();
      const res = await app.inject({
        method: "PATCH",
        url: `${WIDGETS}/nope`,
        payload: { label: "x" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s an unknown id BEFORE validating the body", async () => {
      // Existence has to outrank shape, or a client chasing a 400 spends its
      // time fixing a body for a widget that is not there.
      app = await buildApp();
      const res = await app.inject({
        method: "PATCH",
        url: `${WIDGETS}/nope`,
        payload: { label: 42 },
      });
      expect(res.statusCode).toBe(404);
    });

    it("403s a non-admin before either", async () => {
      app = await buildApp({ role: "standard" });
      const res = await app.inject({
        method: "PATCH",
        url: `${WIDGETS}/nope`,
        payload: { label: 42 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("400s a label that is not a string (tightening, #597)", async () => {
      // Previously stored verbatim: the column took the 42 and the UI read a
      // number where it expects a label. Nothing in the product ever sent one.
      app = await buildApp();
      const id = await createWidget();
      const res = await app.inject({
        method: "PATCH",
        url: `${WIDGETS}/${id}`,
        payload: { label: 42 },
      });
      expect(res.statusCode).toBe(400);
      expect(typeof (res.json() as { error: unknown }).error).toBe("string");
    });
  });

  describe("DELETE /widgets/:id", () => {
    it("deletes and returns 204", async () => {
      app = await buildApp();
      const created = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "equipment", equipmentId: "e1" },
      });
      const id = (created.json() as { id: string }).id;
      const res = await app.inject({ method: "DELETE", url: `${WIDGETS}/${id}` });
      expect(res.statusCode).toBe(204);
      expect((await app.inject({ method: "GET", url: WIDGETS })).json()).toEqual([]);
    });

    it("404s an unknown id", async () => {
      app = await buildApp();
      const res = await app.inject({ method: "DELETE", url: `${WIDGETS}/nope` });
      expect(res.statusCode).toBe(404);
    });

    it("403s a non-admin", async () => {
      app = await buildApp({ role: "standard" });
      const res = await app.inject({ method: "DELETE", url: `${WIDGETS}/nope` });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("PUT /widgets/order", () => {
    it("reorders", async () => {
      app = await buildApp();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await app.inject({
          method: "POST",
          url: WIDGETS,
          payload: { type: "equipment", equipmentId: "e1" },
        });
        ids.push((r.json() as { id: string }).id);
      }
      const res = await app.inject({
        method: "PUT",
        url: `${WIDGETS}/order`,
        payload: { order: [ids[2], ids[0], ids[1]] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      const listed = (await app.inject({ method: "GET", url: WIDGETS })).json() as { id: string }[];
      expect(listed.map((w) => w.id)).toEqual([ids[2], ids[0], ids[1]]);
    });

    it("400s when order is missing or not an array", async () => {
      app = await buildApp();
      for (const payload of [{}, { order: "a,b" }, { order: 3 }]) {
        const res = await app.inject({ method: "PUT", url: `${WIDGETS}/order`, payload });
        expect(res.statusCode).toBe(400);
        expect(typeof (res.json() as { error: unknown }).error).toBe("string");
      }
    });

    it("403s a non-admin before the body check", async () => {
      app = await buildApp({ role: "standard" });
      const res = await app.inject({ method: "PUT", url: `${WIDGETS}/order`, payload: {} });
      expect(res.statusCode).toBe(403);
    });

    it("400s an array whose elements are not ids (tightening, #597)", async () => {
      // Previously these reached the UPDATE and matched no row, so the call
      // reported ok:true having reordered nothing.
      app = await buildApp();
      for (const order of [[1, 2], [null], [""]]) {
        const res = await app.inject({
          method: "PUT",
          url: `${WIDGETS}/order`,
          payload: { order },
        });
        expect(res.statusCode).toBe(400);
      }
    });
  });

  describe("GET /widgets", () => {
    it("is readable by a non-admin", async () => {
      app = await buildApp({ role: "standard" });
      const res = await app.inject({ method: "GET", url: WIDGETS });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });
});
