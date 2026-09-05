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
  dataBindings?: Array<{
    alias?: string;
    category?: string;
    type?: string;
    value?: unknown;
    lastUpdated?: string | null;
  }>;
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

/**
 * The route-to-manager seam for the solar declaration (spec 160, FR9).
 *
 * Every layer of this path passed its own tests while the feature was dead: the
 * body schema bounded the angles, the validator named the bad plane, the manager
 * persisted whatever it was handed. The handler simply never handed it over, so
 * a declaration returned 200 and vanished. Only a test that reads what `update`
 * actually receives can see that.
 */
describe("PUT /api/v1/equipments/:id — solar profile (spec 160)", () => {
  let app: ReturnType<typeof Fastify>;
  let received: Record<string, unknown> | null;

  const validProfile = { planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: 4000 }] };

  beforeEach(async () => {
    received = null;
    app = Fastify({ logger: false, ajv: validationAjvOptions });
    installValidationErrorHandler(app);
    registerEquipmentRoutes(app, {
      equipmentManager: {
        getById: () => ({ id: "eq-1" }),
        update: (_id: string, input: Record<string, unknown>) => {
          received = input;
          return { id: "eq-1", solarProfile: input.solarProfile };
        },
      } as unknown as Parameters<typeof registerEquipmentRoutes>[1]["equipmentManager"],
      logger: createLogger("silent").logger,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const put = (payload: unknown) =>
    app.inject({ method: "PUT", url: "/api/v1/equipments/eq-1", payload });

  it("forwards the declared profile to the manager", async () => {
    const res = await put({ solarProfile: validProfile });
    expect(res.statusCode).toBe(200);
    // The assertion that was missing: not that the call succeeded, but that the
    // profile survived the handler.
    expect(received?.solarProfile).toEqual(validProfile);
  });

  it("forwards an explicit null, so a declaration can be withdrawn", async () => {
    const res = await put({ solarProfile: null });
    expect(res.statusCode).toBe(200);
    expect(received).toHaveProperty("solarProfile", null);
  });

  it("leaves the profile untouched when the body does not mention it", async () => {
    const res = await put({ name: "Shelly Solar" });
    expect(res.statusCode).toBe(200);
    // undefined, not null: the manager keeps the stored value on undefined and
    // clears it on null, so the two must not be conflated here.
    expect(received?.solarProfile).toBeUndefined();
  });

  it("forwards the declared change date (spec 161)", async () => {
    const withSince = { planes: validProfile.planes, since: "2026-08-04" };
    const res = await put({ solarProfile: withSince });
    expect(res.statusCode).toBe(200);
    // The one thing only the household knows: without it a backfill fits across
    // a capacity change and the gain describes neither array.
    expect(received?.solarProfile).toEqual(withSince);
  });

  it("refuses an out-of-range angle before reaching the manager", async () => {
    const res = await put({
      solarProfile: { planes: [{ tiltDeg: 120, azimuthDeg: 180, peakWc: 4000 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(received).toBeNull();
  });
});

describe("PUT /api/v1/equipments/:id — nested submeters (spec 173)", () => {
  let app: ReturnType<typeof Fastify>;
  let received: Record<string, unknown> | null;

  // gite ⊃ ce, and a house total that must never be anyone's parent.
  const graph = [
    { id: "gite", name: "ConsommationGite", type: "energy_meter", meteringParentId: null },
    { id: "ce", name: "ConsommationChauffeEau", type: "energy_meter", meteringParentId: "gite" },
    { id: "edf", name: "EDF", type: "main_energy_meter", meteringParentId: null },
    { id: "plaque", name: "ConsommationPlaqueGite", type: "energy_meter", meteringParentId: null },
    { id: "lampe", name: "Lampe", type: "light_onoff", meteringParentId: null },
  ];

  beforeEach(async () => {
    received = null;
    app = Fastify({ logger: false, ajv: validationAjvOptions });
    installValidationErrorHandler(app);
    registerEquipmentRoutes(app, {
      equipmentManager: {
        getById: (id: string) => graph.find((e) => e.id === id) ?? null,
        // Eligibility asks the enrolment rule, which needs the bindings.
        getByIdWithDetails: (id: string) => {
          const eq = graph.find((e) => e.id === id);
          if (!eq) return null;
          return {
            ...eq,
            dataBindings:
              eq.type === "light_onoff"
                ? [{ alias: "state", category: "light_state", type: "boolean" }]
                : [{ alias: "power", category: "power", type: "number" }],
          };
        },
        getAll: () => graph,
        update: (_id: string, input: Record<string, unknown>) => {
          received = input;
          return { id: _id, meteringParentId: input.meteringParentId };
        },
      } as unknown as Parameters<typeof registerEquipmentRoutes>[1]["equipmentManager"],
      logger: createLogger("silent").logger,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const put = (id: string, payload: unknown) =>
    app.inject({ method: "PUT", url: `/api/v1/equipments/${id}`, payload });

  it("forwards an honest declaration", async () => {
    const res = await put("plaque", { meteringParentId: "gite" });
    expect(res.statusCode).toBe(200);
    expect(received?.meteringParentId).toBe("gite");
  });

  it("forwards an explicit null, so a declaration can be withdrawn", async () => {
    const res = await put("ce", { meteringParentId: null });
    expect(res.statusCode).toBe(200);
    expect(received).toHaveProperty("meteringParentId", null);
  });

  it("leaves it untouched when the body does not mention it", async () => {
    const res = await put("ce", { name: "CE" });
    expect(res.statusCode).toBe(200);
    // undefined ≠ null: the manager keeps the stored value on undefined.
    expect(received?.meteringParentId).toBeUndefined();
  });

  it("answers 404 for a parent that does not exist", async () => {
    const res = await put("plaque", { meteringParentId: "ghost" });
    expect(res.statusCode).toBe(404);
    expect(received).toBeNull();
  });

  it("refuses an equipment metered by itself", async () => {
    const res = await put("gite", { meteringParentId: "gite" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("MeteringParentSelf");
    expect(received).toBeNull();
  });

  it("refuses a loop the pair alone does not reveal", async () => {
    // ce is already inside gite; putting gite inside ce closes the loop.
    const res = await put("gite", { meteringParentId: "ce" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("MeteringParentCycle");
    expect(received).toBeNull();
  });

  it("refuses the house total as a parent", async () => {
    // Everything is inside the house total already; subtracting from it would
    // wreck the residual it defines.
    const res = await put("gite", { meteringParentId: "edf" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("MeteringParentNotSubmeter");
    expect(received).toBeNull();
  });

  it("refuses a parent that measures no consumption at all", async () => {
    // Not a house total, so the blocklist lets it through; it is not a meter
    // either, and the declaration would sit there doing nothing (#873 review).
    const res = await put("plaque", { meteringParentId: "lampe" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("MeteringParentNotSubmeter");
  });
});

// ── #832 — the feed must not serve a leftover as a current measurement ──
//
// The energy display is this feed's consumer and cannot work a reading's age
// out for itself without restating the rule, which is exactly how the web
// breakdown and the arbitration card came to describe one appliance two
// contradictory ways (#744). The verdict is computed here, from the same
// shared rule the web UI uses.
describe("GET /api/v1/equipments?role=submeter — reading freshness (#832)", () => {
  let app: ReturnType<typeof Fastify>;
  const logger = createLogger("silent").logger;

  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const powerAt = (value: unknown, lastUpdated: string | null, freshnessBudgetMs?: number) => [
    { alias: "power", category: "power", type: "number", value, lastUpdated, freshnessBudgetMs },
  ];

  async function build(fixture: FixtureEq[]) {
    const a = Fastify({ logger: false, ajv: validationAjvOptions });
    installValidationErrorHandler(a);
    // Only the manager is cast, matching the harness above: a new required
    // field on the deps object should break the build here too.
    registerEquipmentRoutes(a, { equipmentManager: makeManager(fixture), logger });
    await a.ready();
    return a;
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  async function verdicts(fixture: FixtureEq[]) {
    app = await build(fixture);
    const res = await app.inject({ method: "GET", url: "/api/v1/equipments?role=submeter" });
    return Object.fromEntries(
      (res.json() as { name: string; powerReadingCurrent: boolean | null }[]).map((e) => [
        e.name,
        e.powerReadingCurrent,
      ]),
    );
  }

  it("marks a fresh reading current and an aged one not", async () => {
    const v = await verdicts([
      { id: "1", name: "Piscine", type: "energy_meter", dataBindings: powerAt(1233, ago(40_000)) },
      {
        id: "2",
        name: "Chauffe-eau",
        type: "water_heater",
        // The measured case: 560 W drawn, last reported 944 s earlier.
        dataBindings: powerAt(0, ago(944_000)),
      },
    ]);
    expect(v["Piscine"]).toBe(true);
    expect(v["Chauffe-eau"]).toBe(false);
  });

  it("does not call an offline equipment's last reading current", async () => {
    // The feed keeps offline submeters on purpose, so the display can render
    // an "offline since" row. Their last reading is not a live measurement
    // either, however recent: judging on age alone made this feed disagree
    // with the web breakdown about one appliance at one instant.
    const v = await verdicts([
      {
        id: "1",
        name: "Chauffe-eau",
        type: "water_heater",
        status: "offline",
        dataBindings: powerAt(560, ago(30_000)),
      },
    ]);
    expect(v["Chauffe-eau"]).toBe(false);
  });

  it("does not flag a 300 s source four and a half minutes in, whatever its type", async () => {
    // The budget travels on the binding now (spec 175): 2.5 x 300 s. A meter
    // and an appliance reporting at the same cadence get the same answer,
    // where the equipment type used to decide it.
    const v = await verdicts([
      {
        id: "1",
        name: "Lave-linge",
        type: "appliance",
        dataBindings: powerAt(0, ago(270_000), 750_000),
      },
      {
        id: "2",
        name: "Clamp lent",
        type: "energy_meter",
        dataBindings: powerAt(500, ago(270_000), 750_000),
      },
    ]);
    expect(v["Lave-linge"]).toBe(true);
    expect(v["Clamp lent"]).toBe(true);
  });

  it("holds a streaming meter to the window its own cadence earns", async () => {
    // A source reporting every second earns the 120 s floor, so four and a half
    // minutes of silence is a dead meter, not a slow one.
    const v = await verdicts([
      {
        id: "1",
        name: "Clamp rapide",
        type: "energy_meter",
        dataBindings: powerAt(500, ago(270_000), 120_000),
      },
    ]);
    expect(v["Clamp rapide"]).toBe(false);
  });

  it("falls back to the learning window when the engine resolved no budget", async () => {
    // An old client, or a binding the engine could not resolve: 10 minutes,
    // which is what this feed answered before the field existed.
    const v = await verdicts([
      { id: "1", name: "Inconnu", type: "energy_meter", dataBindings: powerAt(500, ago(270_000)) },
      { id: "2", name: "Muet", type: "energy_meter", dataBindings: powerAt(500, ago(700_000)) },
    ]);
    expect(v["Inconnu"]).toBe(true);
    expect(v["Muet"]).toBe(false);
  });

  it("reports null when there is no numeric power reading to judge", async () => {
    // A declared meter awaiting its first report is kept in the feed on
    // purpose (#527); "current" is not a question that applies to it.
    const v = await verdicts([{ id: "1", name: "Neuf", type: "energy_meter", dataBindings: [] }]);
    expect(v["Neuf"]).toBeNull();
  });

  it("leaves the rest of the payload untouched", async () => {
    // Additive: an existing client keeps parsing exactly what it parses today.
    app = await build([
      { id: "1", name: "Piscine", type: "energy_meter", dataBindings: powerAt(1233, ago(40_000)) },
    ]);
    const res = await app.inject({ method: "GET", url: "/api/v1/equipments?role=submeter" });
    const [eq] = res.json() as Record<string, unknown>[];
    expect(eq.id).toBe("1");
    expect(eq.name).toBe("Piscine");
    expect(eq.type).toBe("energy_meter");
    expect((eq.dataBindings as { value: number }[])[0].value).toBe(1233);
  });
});

// ============================================================
// Spec 174 phase 2 — the timed command
// ============================================================

describe("timed command (spec 174 phase 2)", () => {
  let app: ReturnType<typeof Fastify>;
  let saved: Record<string, unknown> | null;
  let armedWith: { id: string; explicit: boolean } | null;

  // A sliding gate: one impulse order, and the contact that makes it eligible.
  const gate = {
    id: "gate",
    name: "Portail",
    type: "gate",
    orderBindings: [{ id: "o1", alias: "command", type: "string" }],
    dataBindings: [{ id: "d1", alias: "state", category: "gate_state", type: "string" }],
    timedCommand: null as unknown,
  };

  // Spec 178 — what the stubbed engine answers the next press with.
  let givesUp = false;
  let stepIndex = 0;
  let nextDurationMs: number | null = 900_000;

  beforeEach(async () => {
    saved = null;
    armedWith = null;
    givesUp = false;
    stepIndex = 0;
    nextDurationMs = 900_000;
    app = Fastify({ logger: false, ajv: validationAjvOptions });
    installValidationErrorHandler(app);
    registerEquipmentRoutes(app, {
      equipmentManager: {
        getById: (id: string) => (id === gate.id ? gate : null),
        getByIdWithDetails: (id: string) => (id === gate.id ? gate : null),
        getAll: () => [gate],
        update: (_id: string, input: Record<string, unknown>) => {
          saved = input;
          return { id: _id, ...input };
        },
      } as unknown as Parameters<typeof registerEquipmentRoutes>[1]["equipmentManager"],
      timedActionManager: {
        armConfigured: async (id: string) => {
          armedWith = { id, explicit: false };
          if (!gate.timedCommand) {
            const { TimedActionError } = await import("../../equipments/timed-action-manager.js");
            throw new TimedActionError("No timed command configured on this equipment", 409);
          }
          // Spec 178 — null is the press that walked off the top of the ladder.
          if (givesUp) return null;
          return {
            alias: "command",
            value: null,
            revertValue: null,
            expiresAt: "x",
            armedAt: "y",
            stepIndex,
            nextDurationMs,
          };
        },
        arm: async (id: string) => {
          armedWith = { id, explicit: true };
          return { alias: "command", value: null, revertValue: null, expiresAt: "x", armedAt: "y" };
        },
      } as unknown as Parameters<typeof registerEquipmentRoutes>[1]["timedActionManager"],
      logger: createLogger("silent").logger,
    });
    await app.ready();
  });

  afterEach(async () => {
    gate.timedCommand = null;
    await app.close();
  });

  const put = (payload: unknown) =>
    app.inject({ method: "PUT", url: "/api/v1/equipments/gate", payload });
  const arm = (payload?: unknown) =>
    app.inject({ method: "POST", url: "/api/v1/equipments/gate/timed-action", payload });

  it("stores a configuration whose action and revert are the same command", async () => {
    // FR-9b: an impulse. The first draft refused this outright.
    const res = await put({
      timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
    });

    expect(res.statusCode).toBe(200);
    expect(saved?.timedCommand).toEqual({
      alias: "command",
      value: null,
      revertValue: null,
      durationMs: 900_000,
    });
  });

  it("refuses a configuration naming an order the equipment does not carry", async () => {
    const res = await put({
      timedCommand: { alias: "open", value: null, revertValue: null, durationMs: 900_000 },
    });

    // Refused where it is WRITTEN, not where it would be fired.
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("TimedCommandNotEligible");
    expect(saved).toBeNull();
  });

  it("refuses a window outside the bounds", async () => {
    const res = await put({
      timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 500 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("TimedCommandInvalid");
  });

  it("clears the configuration on null", async () => {
    const res = await put({ timedCommand: null });

    expect(res.statusCode).toBe(200);
    expect(saved).toHaveProperty("timedCommand", null);
  });

  it("arms the stored configuration from an empty body", async () => {
    // FR-13 — this is the call BOTH new surfaces make; a schema requiring
    // `alias` here would 400 every press without any test noticing.
    gate.timedCommand = { alias: "command", value: null, revertValue: null, durationMs: 900_000 };

    const res = await arm({});

    expect(res.statusCode).toBe(200);
    expect(armedWith).toEqual({ id: "gate", explicit: false });
  });

  it("answers 409 when nothing is configured to arm", async () => {
    const res = await arm({});

    expect(res.statusCode).toBe(409);
    // Told apart from "cannot be armed": one is a configuration a user can go
    // and write, the other is an equipment that will never do it.
    expect(res.json().error).toMatch(/No timed command/);
  });

  it("still takes an explicit body, and still validates it", async () => {
    const ok = await arm({
      alias: "command",
      value: null,
      revertValue: null,
      durationMs: 900_000,
    });
    expect(ok.statusCode).toBe(200);
    expect(armedWith).toEqual({ id: "gate", explicit: true });

    // Naming an alias brings the other two with it.
    const bad = await arm({ alias: "command" });
    expect(bad.statusCode).toBe(400);
  });

  // ── Spec 178 — the ladder, over the wire ─────────────────────

  it("stores a ladder and forces the duration onto its first step", async () => {
    // FR-1. Two places claiming what the first press does is how they come to
    // disagree, so the API keeps exactly one of them.
    const res = await put({
      timedCommand: {
        alias: "command",
        value: null,
        revertValue: null,
        durationMs: 0,
        durationStepsMs: [900_000, 1_800_000, 3_600_000],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(saved?.timedCommand).toEqual({
      alias: "command",
      value: null,
      revertValue: null,
      durationMs: 900_000,
      durationStepsMs: [900_000, 1_800_000, 3_600_000],
    });
  });

  it("refuses a broken ladder, naming the rule, and persists nothing", async () => {
    const cases: Array<[string, number[]]> = [
      ["a ladder of one", [900_000]],
      ["seven rungs", [1, 2, 3, 4, 5, 6, 7].map((n) => n * 60_000)],
      ["a rung that does not grow", [1_800_000, 900_000]],
      ["a rung below the floor", [500, 900_000]],
      ["a rung past the ceiling", [900_000, 48 * 3_600_000]],
    ];
    for (const [what, durationStepsMs] of cases) {
      const res = await put({
        timedCommand: {
          alias: "command",
          value: null,
          revertValue: null,
          durationMs: 900_000,
          durationStepsMs,
        },
      });
      expect(res.statusCode, what).toBe(400);
      expect(res.json().error, what).toBe("TimedCommandStepsInvalid");
      expect(typeof res.json().message, what).toBe("string");
      expect(saved, what).toBeNull();
    }
  });

  it("answers the climbing press with the rung and the next length", async () => {
    gate.timedCommand = { alias: "command", value: null, revertValue: null, durationMs: 900_000 };
    stepIndex = 1;
    nextDurationMs = 3_600_000;

    const res = await arm({});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ stepIndex: 1, nextDurationMs: 3_600_000 });
  });

  it("answers the give-up press explicitly, not with a bare 204", async () => {
    // FR-5. A surface has to tell "the window is gone because you asked" from a
    // call that failed, and from a window that simply expired.
    gate.timedCommand = { alias: "command", value: null, revertValue: null, durationMs: 900_000 };
    givesUp = true;

    const res = await arm({});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ disarmed: true });
  });
});
