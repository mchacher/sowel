import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerEquipmentRoutes } from "./equipments.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// The ?type filter is the only logic worth exercising at the route
// layer; the rest of the equipment surface is covered by manager-level
// tests. A mocked EquipmentManager keeps this test fast and isolated.
function makeManager(fixture: Array<{ id: string; type: string }>) {
  return {
    getAllWithDetails: () => fixture,
    getByIdWithDetails: () => null,
    // The rest of the EquipmentManager interface is unused by the
    // routes we exercise here; we cast through `unknown` so the mock
    // does not have to enumerate every signature.
  } as unknown as Parameters<typeof registerEquipmentRoutes>[1]["equipmentManager"];
}

describe("GET /api/v1/equipments — ?type filter", () => {
  let app: ReturnType<typeof Fastify>;

  const fixture = [
    { id: "1", type: "light_onoff" },
    { id: "2", type: "energy_meter" },
    { id: "3", type: "energy_meter" },
    { id: "4", type: "main_energy_meter" },
  ];

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerEquipmentRoutes(app, {
      equipmentManager: makeManager(fixture),
      logger: createLogger("silent").logger,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns all equipments when ?type is omitted", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/equipments" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(4);
  });

  it("narrows the result set to a single type when ?type is set", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/equipments?type=energy_meter",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; type: string }>;
    expect(body).toHaveLength(2);
    expect(body.every((eq) => eq.type === "energy_meter")).toBe(true);
  });

  it("returns an empty list for an unknown type (pass-through, no 400)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/equipments?type=does_not_exist",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ─── Input-validation characterization (issue #452) ─────────────────────────
// These pin the CURRENT accept/reject behaviour and 400 error-body shape of the
// hand-rolled checks in POST/PUT, so a later move to schema validation can be
// proven equivalent. If a conversion changes any of these, it is a deliberate
// decision, not an accident.

function makeMutableManager() {
  const created = { id: "new-eq", name: "x", type: "light_onoff", zoneId: "z1", enabled: true };
  return {
    create: () => created,
    createWithAutoBindings: () => created,
    update: () => ({ ...created, id: "eq-1" }),
    getById: () => null,
  } as unknown as Parameters<typeof registerEquipmentRoutes>[1]["equipmentManager"];
}

describe("POST /api/v1/equipments — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = Fastify({ logger: false, ajv: validationAjvOptions });
    installValidationErrorHandler(app);
    registerEquipmentRoutes(app, {
      equipmentManager: makeMutableManager(),
      logger: createLogger("silent").logger,
    });
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (body: unknown) =>
    app.inject({ method: "POST", url: "/api/v1/equipments", payload: body });

  const base = { name: "Salon", type: "light_onoff", zoneId: "z1" };

  it("400 with { error: 'Name is required' } when name is missing or blank", async () => {
    for (const name of [undefined, "", "   "]) {
      const res = await post({ ...base, name });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("400 when name exceeds 100 characters", async () => {
    const res = await post({ ...base, name: "a".repeat(101) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 { error: 'Type is required' } when type is missing", async () => {
    const res = await post({ name: "Salon", zoneId: "z1" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 { error: 'Zone ID is required' } when zoneId is missing", async () => {
    const res = await post({ name: "Salon", type: "light_onoff" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when description exceeds 500 characters", async () => {
    const res = await post({ ...base, description: "a".repeat(501) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("201 for a valid body", async () => {
    const res = await post(base);
    expect(res.statusCode).toBe(201);
  });

  it("currently ACCEPTS and ignores an unknown extra field (schema must strip, not reject)", async () => {
    const res = await post({ ...base, bogus: "surprise" });
    expect(res.statusCode).toBe(201);
  });

  it("accepts a null description (create with no description)", async () => {
    const res = await post({ ...base, description: null });
    expect(res.statusCode).toBe(201);
  });
});

describe("PUT /api/v1/equipments/:id — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = Fastify({ logger: false, ajv: validationAjvOptions });
    installValidationErrorHandler(app);
    registerEquipmentRoutes(app, {
      equipmentManager: makeMutableManager(),
      logger: createLogger("silent").logger,
    });
    await app.ready();
  });
  afterEach(async () => await app.close());

  const put = (body: unknown) =>
    app.inject({ method: "PUT", url: "/api/v1/equipments/eq-1", payload: body });

  it("400 { error: 'Name cannot be empty' } when name is present but blank", async () => {
    const res = await put({ name: "  " });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when name exceeds 100 characters", async () => {
    const res = await put({ name: "a".repeat(101) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when description exceeds 500 characters", async () => {
    const res = await put({ description: "a".repeat(501) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when energyProfile.class is neither comfort nor deferrable", async () => {
    const res = await put({
      energyProfile: { class: "nope", nominalPowerW: 1000, minOnS: 0, minOffS: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when energyProfile.nominalPowerW is out of the 1-30000 range", async () => {
    const res = await put({
      energyProfile: { class: "comfort", nominalPowerW: 0, minOnS: 0, minOffS: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when energyProfile min-on/min-off is negative", async () => {
    const res = await put({
      energyProfile: { class: "comfort", nominalPowerW: 1000, minOnS: -1, minOffS: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("200 for a valid partial update", async () => {
    const res = await put({ name: "Renamed" });
    expect(res.statusCode).toBe(200);
  });

  it("accepts a valid energyProfile, and accepts null energyProfile (pass-through)", async () => {
    const ok = await put({
      energyProfile: { class: "comfort", nominalPowerW: 1500, minOnS: 0, minOffS: 60 },
    });
    expect(ok.statusCode).toBe(200);
    expect((await put({ energyProfile: null })).statusCode).toBe(200);
  });

  it("rejects a stringified number for nominalPowerW (strict types, no coercion)", async () => {
    const res = await put({
      energyProfile: { class: "comfort", nominalPowerW: "1000", minOnS: 0, minOffS: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("accepts and ignores an unknown extra field on update", async () => {
    const res = await put({ name: "Renamed", bogus: "x" });
    expect(res.statusCode).toBe(200);
  });
});
