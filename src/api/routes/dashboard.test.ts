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
import type { RecipeInfo, UserRole } from "../../shared/types.js";

let db: Database.Database;

function seedFixtures(): void {
  db.prepare("INSERT INTO zones (id, name) VALUES ('z1', 'Salon')").run();
  db.prepare(
    "INSERT INTO equipments (id, name, type, zone_id) VALUES ('e1', 'Lampe', 'light', 'z1')",
  ).run();
  // Spec 169 — two instances: one whose recipe declares a tile, one whose
  // recipe does not. The pair is what makes the opt-in testable.
  db.prepare(
    "INSERT INTO recipe_instances (id, recipe_id, params) VALUES ('ri1', 'with-tile', '{}')",
  ).run();
  db.prepare(
    "INSERT INTO recipe_instances (id, recipe_id, params) VALUES ('ri2', 'no-tile', '{}')",
  ).run();
}

const RECIPES: Record<string, RecipeInfo> = {
  "with-tile": {
    id: "with-tile",
    name: "With tile",
    description: "",
    slots: [],
    tile: { icon: "Truck", actions: ["set_mode"] },
  },
  "no-tile": { id: "no-tile", name: "No tile", description: "", slots: [] },
};

async function buildApp(opts: { authed?: boolean; role?: UserRole } = {}) {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  if (opts.authed !== false) {
    app.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role: opts.role ?? "admin" };
    });
  }
  registerDashboardRoutes(app, {
    db,
    recipeManager: { getRecipeById: (id: string) => RECIPES[id] ?? null },
  });
  await app.ready();
  return app;
}

const WIDGETS = "/api/v1/dashboard/widgets";

/**
 * The 400 contract #482 exists to preserve: `{ error: <reason> }` and nothing
 * else. Asserting only `typeof error === "string"` would also accept Fastify's
 * default envelope `{ statusCode, code, error: "Bad Request", message }`,
 * which is a different body a client would have to parse differently.
 */
function expectAppErrorShape(body: unknown): void {
  const b = body as Record<string, unknown>;
  expect(typeof b.error).toBe("string");
  expect(b.statusCode).toBeUndefined();
  expect(b.code).toBeUndefined();
  expect(b.message).toBeUndefined();
}

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
        expectAppErrorShape(res.json());
      });
    }

    it("still accepts a null label or icon, as it always did", async () => {
      // The old code never type-checked these and stored `label ?? null`, so an
      // explicit null meant "no label". Rejecting it would have been an
      // undeclared behaviour change on a field this conversion is not about.
      app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "equipment", equipmentId: "e1", label: null, icon: null },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { label?: string }).label).toBeUndefined();
    });

    it("still ignores a family sent on an equipment widget", async () => {
      // `if`/`then` only ADDS requirements; it never forbids the other branch's
      // fields, and the handler stores null for them. Same as before.
      app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "equipment", equipmentId: "e1", family: "lights" },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { family?: string }).family).toBeUndefined();
    });

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

    it("403s a non-admin whose path is percent-encoded", async () => {
      // The gate matches the DECODED path, because the router decodes before
      // matching: comparing request.url raw is what let /api/v1/%62ackup past
      // the backup gate.
      app = await buildApp({ role: "standard" });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/dashboard/%77idgets",
        payload: { type: "equipment", equipmentId: "e1" },
      });
      expect(res.statusCode).toBe(403);
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

    it("returns the widget unchanged when no body is sent at all", async () => {
      // Distinct from the `{}` case above, and the one a schema most easily
      // breaks: a script polling a widget's state with a bare `curl -X PATCH`
      // would otherwise get a 400 about a body it never sent.
      app = await buildApp();
      const id = await createWidget();
      const res = await app.inject({ method: "PATCH", url: `${WIDGETS}/${id}` });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { id: string }).id).toBe(id);
    });

    it("still accepts any object as config, and still clears it on null", async () => {
      app = await buildApp();
      const id = await createWidget();
      await app.inject({
        method: "PATCH",
        url: `${WIDGETS}/${id}`,
        payload: { config: { anything: [1, 2] } },
      });
      const cleared = await app.inject({
        method: "PATCH",
        url: `${WIDGETS}/${id}`,
        payload: { config: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect((cleared.json() as { config?: unknown }).config).toBeUndefined();
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
      expectAppErrorShape(res.json());
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
        expectAppErrorShape(res.json());
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

    it("answers HEAD to a non-admin too", async () => {
      // Fastify auto-exposes HEAD for every GET. A hook that exempts only GET
      // turns a cheap liveness probe into a 403 for a user who can read the
      // list a moment earlier.
      app = await buildApp({ role: "standard" });
      const res = await app.inject({ method: "HEAD", url: WIDGETS });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("no auth context at all", () => {
    it("403s a write when the request carries no identity", async () => {
      // requireAdmin has two halves; only the wrong-role half was exercised.
      app = await buildApp({ authed: false });
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "equipment", equipmentId: "e1" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("still serves the read", async () => {
      app = await buildApp({ authed: false });
      expect((await app.inject({ method: "GET", url: WIDGETS })).statusCode).toBe(200);
    });
  });
  // ── Spec 169 — recipe tiles ───────────────────────────────────────────────

  describe("recipe widgets (spec 169)", () => {
    it("creates one for an instance whose recipe declares a tile", async () => {
      app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "recipe", recipeInstanceId: "ri1" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body.type).toBe("recipe");
      expect(body.recipeInstanceId).toBe("ri1");
      // The two sibling ids stay absent rather than coming back as null.
      expect(body.equipmentId).toBeUndefined();
      expect(body.zoneId).toBeUndefined();
    });

    it("400s without recipeInstanceId — the schema's if/then", async () => {
      app = await buildApp();
      const res = await app.inject({ method: "POST", url: WIDGETS, payload: { type: "recipe" } });
      expect(res.statusCode).toBe(400);
      expectAppErrorShape(res.json());
    });

    it("400s on an unknown instance", async () => {
      app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "recipe", recipeInstanceId: "nope" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe("Recipe instance not found");
    });

    it("400s when the recipe declares no tile — the opt-in", async () => {
      // The instance exists and is perfectly valid; what is missing is the
      // recipe author's consent to have a Dashboard surface at all.
      app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "recipe", recipeInstanceId: "ri2" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe("Recipe declares no tile");
    });

    it("403s a non-admin before it ever looks the instance up", async () => {
      app = await buildApp({ role: "standard" });
      const res = await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "recipe", recipeInstanceId: "ri1" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("lists all three widget types side by side, each with only its own id", async () => {
      app = await buildApp();
      await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "equipment", equipmentId: "e1" },
      });
      await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "zone", zoneId: "z1", family: "lights" },
      });
      await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "recipe", recipeInstanceId: "ri1" },
      });

      const res = await app.inject({ method: "GET", url: WIDGETS });
      const widgets = res.json() as Record<string, unknown>[];
      expect(widgets.map((w) => w.type)).toEqual(["equipment", "zone", "recipe"]);
      expect(widgets[2].recipeInstanceId).toBe("ri1");
      expect(widgets[0].recipeInstanceId).toBeUndefined();
    });

    it("deleting the instance takes its widget with it (FK cascade)", async () => {
      app = await buildApp();
      await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "recipe", recipeInstanceId: "ri1" },
      });
      expect((await app.inject({ method: "GET", url: WIDGETS })).json()).toHaveLength(1);

      db.prepare("DELETE FROM recipe_instances WHERE id = 'ri1'").run();

      expect((await app.inject({ method: "GET", url: WIDGETS })).json()).toHaveLength(0);
    });

    it("keeps the equipment and zone widgets working across the recreated table", async () => {
      // The migration drops and rebuilds dashboard_widgets; the two original
      // foreign keys have to survive that, not just the new one.
      app = await buildApp();
      await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "equipment", equipmentId: "e1" },
      });
      await app.inject({
        method: "POST",
        url: WIDGETS,
        payload: { type: "zone", zoneId: "z1", family: "lights" },
      });

      db.prepare("DELETE FROM equipments WHERE id = 'e1'").run();
      const afterEquipment = (
        await app.inject({ method: "GET", url: WIDGETS })
      ).json() as unknown[];
      expect(afterEquipment).toHaveLength(1);

      db.prepare("DELETE FROM zones WHERE id = 'z1'").run();
      expect((await app.inject({ method: "GET", url: WIDGETS })).json()).toHaveLength(0);
    });
  });

  // ============================================================
  // Spec 174 phase 2 — the timed variant of an equipment tile
  // ============================================================

  describe("POST /api/v1/dashboard/widgets — timed variant (spec 174)", () => {
    it("persists config.timed at creation, not only through a later PATCH", async () => {
      // Found on a shadow instance: the picker sent `{ timed: true }`, the route
      // accepted the call and dropped the field, so the pinned tile came back as
      // an ordinary one and actuated outright.
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/dashboard/widgets",
        payload: { type: "equipment", equipmentId: "e1", config: { timed: true } },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().config).toEqual({ timed: true });

      const list = await app.inject({ method: "GET", url: "/api/v1/dashboard/widgets" });
      expect(list.json().find((w: { id: string }) => w.id === res.json().id).config).toEqual({
        timed: true,
      });
      await app.close();
    });

    it("leaves a widget created without one carrying no config at all", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/dashboard/widgets",
        payload: { type: "equipment", equipmentId: "e1" },
      });

      expect(res.json().config).toBeUndefined();
      await app.close();
    });
  });
});
