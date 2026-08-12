import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerZoneRoutes } from "./zones.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452): pin the accept/reject matrix
// and { error } 400 shape of the POST/PUT /zones checks so the schema move is
// provably regression-free.

function makeDeps() {
  const zone = { id: "z-new", name: "x", parentId: null };
  return {
    zoneManager: {
      create: () => zone,
      update: () => ({ ...zone, id: "z-1" }),
    },
    zoneAggregator: {},
    equipmentManager: {},
  } as unknown as Parameters<typeof registerZoneRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  registerZoneRoutes(app, { ...makeDeps(), logger: createLogger("silent").logger });
  return app;
}

describe("POST /api/v1/zones — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (body: unknown) =>
    app.inject({ method: "POST", url: "/api/v1/zones", payload: body });

  it("400 { error } when name is missing or blank", async () => {
    for (const name of [undefined, "", "   "]) {
      const res = await post({ name });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("400 when name exceeds 100 characters", async () => {
    const res = await post({ name: "a".repeat(101) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when description exceeds 500 characters", async () => {
    const res = await post({ name: "Salon", description: "a".repeat(501) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("201 for a valid body, and accepts null description + extra fields", async () => {
    expect((await post({ name: "Salon" })).statusCode).toBe(201);
    expect((await post({ name: "Salon", description: null })).statusCode).toBe(201);
    expect((await post({ name: "Salon", parentId: "p", icon: "Home", bogus: 1 })).statusCode).toBe(
      201,
    );
  });
});

describe("PUT /api/v1/zones/:id — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const put = (body: unknown) =>
    app.inject({ method: "PUT", url: "/api/v1/zones/z-1", payload: body });

  it("400 when name is present but blank", async () => {
    const res = await put({ name: "  " });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when name exceeds 100 / description exceeds 500", async () => {
    expect((await put({ name: "a".repeat(101) })).statusCode).toBe(400);
    expect((await put({ description: "a".repeat(501) })).statusCode).toBe(400);
  });

  it("200 for a valid partial update, null description, and extra fields", async () => {
    expect((await put({ name: "Renamed" })).statusCode).toBe(200);
    expect((await put({ description: null })).statusCode).toBe(200);
    expect((await put({ parentId: null, bogus: 1 })).statusCode).toBe(200);
  });

  it("200 for a body-less PUT (old `request.body ?? {}` no-op update)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/zones/z-1" });
    expect(res.statusCode).toBe(200);
  });
});
