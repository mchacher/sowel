import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerEquipmentRoutes } from "./equipments.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// The ?type / ?role filter is the only logic worth exercising at the route
// layer; the rest of the equipment surface is covered by manager-level
// tests. A mocked EquipmentManager keeps this test fast and isolated.
interface FixtureEq {
  id: string;
  name: string;
  type: string;
  status?: string;
  dataBindings?: Array<{ alias?: string; category?: string; type?: string }>;
}
function makeManager(fixture: FixtureEq[]) {
  return {
    getAllWithDetails: () => fixture,
    getByIdWithDetails: () => null,
    // The rest of the EquipmentManager interface is unused by the
    // routes we exercise here; we cast through `unknown` so the mock
    // does not have to enumerate every signature.
  } as unknown as Parameters<typeof registerEquipmentRoutes>[1]["equipmentManager"];
}

describe("GET /api/v1/equipments — ?type / ?role filter", () => {
  let app: ReturnType<typeof Fastify>;

  const power = [{ alias: "power", category: "power", type: "number" }];
  const energyCh = [{ alias: "energy", category: "energy", type: "number" }];
  const state = [{ alias: "state", category: "light_state", type: "boolean" }];
  const booleanPower = [{ alias: "power", category: "power", type: "boolean" }];
  const fixture: FixtureEq[] = [
    { id: "1", name: "Lampe", type: "light_onoff", dataBindings: [] },
    { id: "2", name: "Cuisine", type: "energy_meter", dataBindings: [] },
    { id: "3", name: "Salon", type: "energy_meter", dataBindings: [] },
    { id: "4", name: "Compteur", type: "main_energy_meter", dataBindings: power }, // house total, never a submeter
    { id: "5", name: "Chauffe-eau", type: "water_heater", dataBindings: power }, // metering relay (#521) → submeter
    { id: "6", name: "Prise", type: "switch", dataBindings: power }, // metering plug (spec 129) → submeter
    { id: "7", name: "Relais", type: "switch", dataBindings: state }, // bare relay → not a submeter
    { id: "8", name: "Clim", type: "thermostat", dataBindings: power }, // #523 metered load → submeter
    { id: "9", name: "Clim ecran", type: "thermostat", dataBindings: booleanPower }, // boolean gate → NOT
    { id: "10", name: "TV", type: "media_player", dataBindings: booleanPower }, // boolean gate → NOT
    { id: "11", name: "Solaire", type: "solar_panel", dataBindings: power }, // production, never a submeter
    { id: "12", name: "Seche-linge", type: "appliance", dataBindings: energyCh }, // #523 metered load → submeter
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
    expect(res.json()).toHaveLength(12);
  });

  it("narrows the result set to a single type for a non-meter ?type", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/equipments?type=light_onoff" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FixtureEq[];
    expect(body.map((e) => e.id)).toEqual(["1"]);
  });

  it("?role=submeter returns numeric-metered loads except house/production, ordered clamps-first (#523/#590)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/equipments?role=submeter" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FixtureEq[];
    // energy_meters (2,3) → metering relays (5 water_heater, 6 switch) → other
    // metered load (8 thermostat #523), each group by name.
    // NOT: main_energy_meter (4), solar_panel (11), bare relay (7), no-channel
    // light (1), boolean-`power` loads (9 thermostat, 10 media_player), or
    // 12 appliance — it enrols as a submeter via its cumulative `energy` channel
    // (#523) but carries NO numeric `power`, so it has no live segment and is
    // dropped from this live-power feed (#590; see the dedicated block below).
    // Deterministic order so the display's 8-slot cap keeps clamps first.
    expect(body.map((e) => e.id)).toEqual(["2", "3", "5", "6", "8"]);
  });

  it("?type=energy_meter is honoured as the submeter role for the legacy display client, same ordered set (#224/#523/#590)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/equipments?type=energy_meter" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FixtureEq[];
    expect(body.map((e) => e.id)).toEqual(["2", "3", "5", "6", "8"]);
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

// The submeter feed is the energy display's live-power breakdown source. A load
// that enrols as a submeter only through a cumulative `energy` (Wh) channel — a
// SmartThings appliance whose sole `power` binding is a boolean on/off state —
// has no live watts and used to surface as a "pas de mesure" row on the display
// (#590). The web UI already drops such rows (#560); this pins the same rule on
// the API path that the (unflashed) display consumes.
describe("GET /api/v1/equipments — submeter live-power filter (#590)", () => {
  let app: ReturnType<typeof Fastify>;

  const energyOnly = [{ alias: "energy", category: "energy", type: "number" }];
  const numericPower = [{ alias: "power", category: "power", type: "number" }];
  const booleanPower = [{ alias: "power", category: "power", type: "boolean" }];

  const fixture: FixtureEq[] = [
    // Declared clamp with no reading yet (#527) — kept (renders pending).
    { id: "clamp", name: "AAA Clamp", type: "energy_meter", status: "online", dataBindings: [] },
    // Real clamp reporting watts — kept.
    {
      id: "live",
      name: "BBB Live",
      type: "energy_meter",
      status: "online",
      dataBindings: numericPower,
    },
    // Appliance reporting real watts — kept (has a live segment).
    {
      id: "wattbox",
      name: "Wattbox",
      type: "appliance",
      status: "online",
      dataBindings: numericPower,
    },
    // Energy-only appliance, ONLINE — dropped: enrols via `energy`, no live watts.
    {
      id: "washer-on",
      name: "Washer On",
      type: "appliance",
      status: "online",
      dataBindings: energyOnly,
    },
    // Same appliance but OFFLINE — kept: an offline legend row is meaningful.
    {
      id: "washer-off",
      name: "Washer Off",
      type: "appliance",
      status: "offline",
      dataBindings: energyOnly,
    },
    // Appliance whose only `power` binding is a boolean on/off state (the exact
    // SmartThings shape) with an `energy` channel — dropped when online.
    {
      id: "smartthings",
      name: "Lave-linge",
      type: "appliance",
      status: "online",
      dataBindings: [...booleanPower, ...energyOnly],
    },
  ];

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerEquipmentRoutes(app, {
      equipmentManager: makeManager(fixture),
      logger: createLogger("silent").logger,
    });
    await app.ready();
  });

  afterEach(async () => await app.close());

  it("keeps live-power submeters, offline rows and declared meters; drops online energy-only loads", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/equipments?type=energy_meter" });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as FixtureEq[]).map((e) => e.id);
    // Kept: declared clamp, live clamp, watt appliance, offline washer.
    expect(ids).toContain("clamp");
    expect(ids).toContain("live");
    expect(ids).toContain("wattbox");
    expect(ids).toContain("washer-off");
    // Dropped: online energy-only appliance and the boolean-`power` SmartThings load.
    expect(ids).not.toContain("washer-on");
    expect(ids).not.toContain("smartthings");
  });

  it("?role=submeter applies the same live-power filter", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/equipments?role=submeter" });
    const ids = (res.json() as FixtureEq[]).map((e) => e.id);
    expect(ids).not.toContain("smartthings");
    expect(ids).not.toContain("washer-on");
    expect(ids).toContain("washer-off");
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

  it("accepts a boolean invertDirection (#614)", async () => {
    expect((await put({ invertDirection: true })).statusCode).toBe(200);
    expect((await put({ invertDirection: false })).statusCode).toBe(200);
  });

  it("400 when invertDirection is not a boolean (strict types, no coercion)", async () => {
    const res = await put({ invertDirection: "yes" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("accepts gateTriggerMode 'fixed' or 'toggle' (#627)", async () => {
    expect((await put({ gateTriggerMode: "toggle" })).statusCode).toBe(200);
    expect((await put({ gateTriggerMode: "fixed" })).statusCode).toBe(200);
  });

  it("400 when gateTriggerMode is not a valid enum value", async () => {
    const res = await put({ gateTriggerMode: "invert" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
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

describe("POST /api/v1/equipments/:id/(data|order)-bindings — validation", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = Fastify({ logger: false, ajv: validationAjvOptions });
    installValidationErrorHandler(app);
    const manager = {
      getAllWithDetails: () => [],
      addDataBinding: () => ({ id: "db-1" }),
      addOrderBinding: () => ({ id: "ob-1" }),
    } as unknown as Parameters<typeof registerEquipmentRoutes>[1]["equipmentManager"];
    registerEquipmentRoutes(app, {
      equipmentManager: manager,
      logger: createLogger("silent").logger,
    });
    await app.ready();
  });
  afterEach(async () => await app.close());

  const dataUrl = "/api/v1/equipments/eq-1/data-bindings";
  const orderUrl = "/api/v1/equipments/eq-1/order-bindings";
  const post = (url: string, body: unknown) => app.inject({ method: "POST", url, payload: body });

  it("data-bindings: 400 { error } when deviceDataId or alias is missing/blank", async () => {
    // old: `!deviceDataId` (bare) + `!alias?.trim()` (rejects whitespace)
    for (const body of [
      { alias: "temp" },
      { deviceDataId: "d-1" },
      { deviceDataId: "d-1", alias: "   " },
    ]) {
      const res = await post(dataUrl, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("data-bindings: 201 for a valid body", async () => {
    const res = await post(dataUrl, { deviceDataId: "d-1", alias: "temp" });
    expect(res.statusCode).toBe(201);
  });

  it("order-bindings: 400 when deviceOrderId or alias is missing/blank", async () => {
    for (const body of [
      { alias: "on" },
      { deviceOrderId: "o-1" },
      { deviceOrderId: "o-1", alias: "  " },
    ]) {
      const res = await post(orderUrl, body);
      expect(res.statusCode).toBe(400);
    }
  });

  it("order-bindings: 201 for a valid body", async () => {
    const res = await post(orderUrl, { deviceOrderId: "o-1", alias: "on" });
    expect(res.statusCode).toBe(201);
  });
});
