import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerEnergyRoutes } from "./energy.js";
import type { TariffConfig } from "../../shared/types.js";

// Spec 119 — Integration tests on /api/v1/energy/history and
// /api/v1/energy/by-usage.  Validates the always-N-points-per-period
// contract (24 / 7 / 28-31 / 12), TZ-aligned boundaries, HP/HC
// preservation and zero-fill of empty buckets.
//
// Influx is mocked: each test prepares a list of rows that the route
// observes as if Flux returned them.  The exact Flux query string is
// not asserted byte-for-byte (would couple the test to the query
// formatting); the observable response shape is.

const logger = createLogger("silent").logger;

interface PreparedRow {
  _time: string;
  _value: number;
  alias?: string;
}

function makeRow(obj: PreparedRow) {
  return {
    values: obj as never,
    tableMeta: { toObject: () => obj } as never,
  };
}

interface BuildOpts {
  hpHcRows?: PreparedRow[];
  legacyRows?: PreparedRow[];
  productionRows?: PreparedRow[];
  submeterRowsById?: Record<string, PreparedRow[]>;
  mainConsumptionRows?: PreparedRow[];
  equipments?: Array<{
    id: string;
    name: string;
    type: "main_energy_meter" | "energy_meter" | "energy_production_meter";
    enabled?: boolean;
  }>;
  envTz?: string | undefined;
  /** Spec 123 — inject a tariff config for cost-wiring tests. */
  tariff?: TariffConfig | null;
  /** Issue #381 — role decorated on request.auth. Defaults to admin;
   *  null leaves request.auth undefined (unauthenticated). */
  authRole?: "admin" | "standard" | null;
}

async function buildApp(opts: BuildOpts = {}) {
  // Mock InfluxClient: getClient() returns an object whose
  // getQueryApi(org).iterateRows(flux) yields prepared rows.  Each
  // route invocation pulls from the prepared lists in order of the
  // helper calls; we route by inspecting the flux's alias filter.
  const influxClient = {
    getConfig: () => ({ bucket: "sowel", org: "sowel" }),
    getClient: () =>
      ({
        getQueryApi: () => ({
          iterateRows: async function* (flux: string) {
            // Route by the alias filter the Flux query embeds.
            let rows: PreparedRow[] = [];
            if (
              flux.includes(
                'r.alias == "energy_hp" or r.alias == "energy_hc" or r.alias == "energy"',
              )
            ) {
              rows = opts.mainConsumptionRows ?? [];
            } else if (flux.includes('r.alias == "energy_hp" or r.alias == "energy_hc"')) {
              rows = opts.hpHcRows ?? [];
            } else if (
              flux.includes(
                'r.alias == "energy" or r.alias == "autoconso" or r.alias == "injection"',
              )
            ) {
              rows = opts.productionRows ?? [];
            } else if (flux.includes('r.alias == "energy"')) {
              // Submeter or legacy energy.  Submeter is per-equipment;
              // we route by equipmentId.
              const idMatch = flux.match(/r\.equipmentId == "([^"]+)"/);
              const id = idMatch?.[1];
              if (id && opts.submeterRowsById && id in opts.submeterRowsById) {
                rows = opts.submeterRowsById[id];
              } else {
                rows = opts.legacyRows ?? [];
              }
            }
            for (const r of rows) yield makeRow(r);
          },
        }),
      }) as never,
  };

  // Mock EquipmentManager — only `getAll()` is consumed by the routes.
  const equipments = opts.equipments ?? [];
  const equipmentManager = {
    getAll: () => equipments,
  } as never;

  // tariffClassifier returns the injected config (spec 123 — used for cost wiring).
  const tariffClassifier = { getConfig: () => opts.tariff ?? null } as never;
  const settingsManager = {} as never;

  const app = Fastify({ logger: false });

  // Stub auth: pre-decorate request.auth based on the test scenario (#381).
  const authRole = opts.authRole === undefined ? "admin" : opts.authRole;
  if (authRole !== null) {
    app.addHook("preHandler", async (request) => {
      request.auth = { userId: "u1", role: authRole };
    });
  }

  registerEnergyRoutes(app, {
    equipmentManager,
    influxClient: influxClient as never,
    settingsManager,
    tariffClassifier,
    logger,
  });
  await app.ready();
  return app;
}

describe("Spec 119 — /api/v1/energy/history", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    // Pin TZ so test results are deterministic across CI environments.
    process.env.TZ = "Europe/Paris";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  // ---- Bucket count per period --------------------------------

  it("day → returns 24 hourly buckets, zero-filling empties", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      // Influx returns 3 hours of HP data; the other 21 hours are empty.
      hpHcRows: [
        { _time: "2026-05-29T22:00:00Z", _value: 100, alias: "energy_hp" },
        { _time: "2026-05-29T23:00:00Z", _value: 120, alias: "energy_hp" },
        { _time: "2026-05-30T00:00:00Z", _value: 80, alias: "energy_hp" },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=day&date=2026-05-30",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points).toHaveLength(24);
    // Hours 0-2 are non-zero (the three prepared rows), all others zero.
    expect(body.points[0].hp).toBe(100);
    expect(body.points[1].hp).toBe(120);
    expect(body.points[2].hp).toBe(80);
    expect(body.points[3].hp).toBe(0);
    expect(body.points[23].hp).toBe(0);
    expect(body.points[23].hc).toBe(0);
    expect(body.points[23].prod).toBe(0);
  });

  it("week → returns 7 daily buckets, zero-filling missing days", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      // Mon-Wed populated; Thu-Sun empty.
      hpHcRows: [
        { _time: "2026-05-24T22:00:00Z", _value: 1000, alias: "energy_hp" }, // Mon 26
        { _time: "2026-05-25T22:00:00Z", _value: 1200, alias: "energy_hp" }, // Tue 27
        { _time: "2026-05-26T22:00:00Z", _value: 1100, alias: "energy_hp" }, // Wed 28
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=week&date=2026-05-30",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points).toHaveLength(7);
    expect(body.resolution).toBe("1d");
    expect(body.points[0].hp).toBe(1000); // Mon
    expect(body.points[1].hp).toBe(1200); // Tue
    expect(body.points[2].hp).toBe(1100); // Wed
    expect(body.points[3].hp).toBe(0); // Thu
    expect(body.points[6].hp).toBe(0); // Sun
  });

  it("month (non-leap February 2026) → returns 28 daily buckets", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=month&date=2026-02-15",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points).toHaveLength(28);
    expect(body.resolution).toBe("1d");
  });

  it("month (leap February 2024) → returns 29 daily buckets", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=month&date=2024-02-15",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points).toHaveLength(29);
  });

  it("year → returns 12 monthly buckets, resolution 1mo", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      // Jan, Mar populated; rest empty.
      hpHcRows: [
        { _time: "2025-12-31T23:00:00Z", _value: 100_000, alias: "energy_hp" }, // Jan 2026 in Paris TZ
        { _time: "2026-02-28T23:00:00Z", _value: 120_000, alias: "energy_hp" }, // Mar 2026
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=year&date=2026-06-15",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points).toHaveLength(12);
    expect(body.resolution).toBe("1mo");
  });

  // ---- HP/HC preservation -------------------------------------

  it("week → preserves HP and HC independently on each daily bucket", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      hpHcRows: [
        { _time: "2026-05-24T22:00:00Z", _value: 800, alias: "energy_hp" }, // Mon HP
        { _time: "2026-05-24T22:00:00Z", _value: 200, alias: "energy_hc" }, // Mon HC
        { _time: "2026-05-25T22:00:00Z", _value: 900, alias: "energy_hp" }, // Tue HP
        { _time: "2026-05-25T22:00:00Z", _value: 300, alias: "energy_hc" }, // Tue HC
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=week&date=2026-05-30",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points).toHaveLength(7);
    expect(body.points[0]).toMatchObject({ hp: 800, hc: 200 });
    expect(body.points[1]).toMatchObject({ hp: 900, hc: 300 });
  });

  // ---- Resolution literal -------------------------------------

  it("resolution literal — 1h / 1d / 1d / 1mo for day / week / month / year", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
    });

    const resolutions: Record<string, string> = {};
    for (const p of ["day", "week", "month", "year"] as const) {
      const r = await app.inject({
        method: "GET",
        url: `/api/v1/energy/history?period=${p}&date=2026-05-30`,
      });
      resolutions[p] = r.json().resolution;
    }
    expect(resolutions).toEqual({
      day: "1h",
      week: "1d",
      month: "1d",
      year: "1mo",
    });
  });

  // ---- Edge cases ---------------------------------------------

  it("fresh install (no Influx data at all) — still returns N buckets", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      // no rows prepared
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=year&date=2026-01-01",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().points).toHaveLength(12);
    // All zero
    expect(
      r
        .json()
        .points.every(
          (p: { hp: number; hc: number; prod: number }) => p.hp === 0 && p.hc === 0 && p.prod === 0,
        ),
    ).toBe(true);
  });

  it("invalid period returns 400", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=hour&date=2026-05-30",
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("Spec 119 — /api/v1/energy/by-usage", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("week → 7 daily points per submeter", async () => {
    app = await buildApp({
      equipments: [
        { id: "sub-A", name: "Cuisine", type: "energy_meter" },
        { id: "sub-B", name: "Salon", type: "energy_meter" },
      ],
      submeterRowsById: {
        "sub-A": [
          { _time: "2026-05-24T22:00:00Z", _value: 500, alias: "energy" },
          { _time: "2026-05-25T22:00:00Z", _value: 600, alias: "energy" },
        ],
        "sub-B": [{ _time: "2026-05-24T22:00:00Z", _value: 200, alias: "energy" }],
      },
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.resolution).toBe("1d");
    expect(body.submeters).toHaveLength(2);
    for (const sm of body.submeters) {
      expect(sm.points).toHaveLength(7);
    }
    // Submeter A's first two days populated, rest zero.
    const subA = body.submeters.find((s: { id: string }) => s.id === "sub-A");
    expect(subA.points[0].wh).toBe(500);
    expect(subA.points[1].wh).toBe(600);
    expect(subA.points[2].wh).toBe(0);
  });

  it("year → 12 monthly points per submeter, zero-filled", async () => {
    app = await buildApp({
      equipments: [{ id: "sub-A", name: "Cuisine", type: "energy_meter" }],
      // no submeter rows = fully empty year
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/by-usage?period=year&date=2026-06-15",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.resolution).toBe("1mo");
    expect(body.submeters[0].points).toHaveLength(12);
    expect(body.submeters[0].points.every((p: { wh: number }) => p.wh === 0)).toBe(true);
  });
});

// ===============================================================
// Spec 123 — cost valuation
// ===============================================================

const TARIFF_20_10: TariffConfig = {
  schedules: [],
  prices: { hp: 0.2, hc: 0.1 },
};

describe("Spec 123 — /api/v1/energy/history cost valuation", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("attaches cost_hp / cost_hc / cost_total to each point when tariff is configured", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      hpHcRows: [
        { _time: "2026-05-29T22:00:00Z", _value: 1000, alias: "energy_hp" }, // 1 kWh HP
        { _time: "2026-05-29T22:00:00Z", _value: 500, alias: "energy_hc" }, // 0.5 kWh HC
      ],
      tariff: TARIFF_20_10,
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=day&date=2026-05-30",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.points[0]).toMatchObject({
      hp: 1000,
      hc: 500,
      cost_hp: 0.2, // 1 kWh × 0.20
      cost_hc: 0.05, // 0.5 kWh × 0.10
      cost_total: 0.25,
    });
  });

  it("totals.cost_* reflect grid-side hp/hc (autoconso-subtracted)", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      hpHcRows: [{ _time: "2026-05-29T22:00:00Z", _value: 2000, alias: "energy_hp" }],
      tariff: TARIFF_20_10,
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=day&date=2026-05-30",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.totals).toMatchObject({
      total_hp: 2000,
      total_hc: 0,
      cost_hp: 0.4,
      cost_hc: 0,
      cost_total: 0.4,
    });
  });

  it("returns zero cost when tariff config is missing", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      hpHcRows: [{ _time: "2026-05-29T22:00:00Z", _value: 1000, alias: "energy_hp" }],
      // no tariff
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=day&date=2026-05-30",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.points[0].cost_hp).toBe(0);
    expect(body.points[0].cost_hc).toBe(0);
    expect(body.points[0].cost_total).toBe(0);
    expect(body.totals.cost_total).toBe(0);
  });

  it("returns zero cost when both prices are 0", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      hpHcRows: [{ _time: "2026-05-29T22:00:00Z", _value: 1000, alias: "energy_hp" }],
      tariff: { schedules: [], prices: { hp: 0, hc: 0 } },
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=day&date=2026-05-30",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().totals.cost_total).toBe(0);
  });

  it("empty points (no data) → totals cost = 0", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      tariff: TARIFF_20_10,
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=year&date=2026-06-15",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.totals.cost_total).toBe(0);
    expect(body.points.every((p: { cost_total: number }) => p.cost_total === 0)).toBe(true);
  });
});

describe("Spec 123 — /api/v1/energy/by-usage cost valuation (blended)", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("submeter cost = wh × blended rate when main meter HP/HC present", async () => {
    // Main meter: 1000 Wh HP + 1000 Wh HC over the week → 2 kWh × blended 0.15 €/kWh = 0.30 €
    // Submeter A: 500 Wh total → 0.5 kWh × 0.15 = 0.075 €
    app = await buildApp({
      equipments: [
        { id: "meter-1", name: "Compteur", type: "main_energy_meter" },
        { id: "sub-A", name: "Cuisine", type: "energy_meter" },
      ],
      hpHcRows: [
        { _time: "2026-05-24T22:00:00Z", _value: 1000, alias: "energy_hp" },
        { _time: "2026-05-24T22:00:00Z", _value: 1000, alias: "energy_hc" },
      ],
      submeterRowsById: {
        "sub-A": [{ _time: "2026-05-24T22:00:00Z", _value: 500, alias: "energy" }],
      },
      mainConsumptionRows: [{ _time: "2026-05-24T22:00:00Z", _value: 2000, alias: "energy" }],
      tariff: TARIFF_20_10,
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const subA = body.submeters.find((s: { id: string }) => s.id === "sub-A");
    expect(subA.cost).toBeCloseTo(0.075, 4);
    expect(body.totals.costByEquipment["sub-A"]).toBeCloseTo(0.075, 4);
    // total: 2 kWh × 0.15 = 0.30
    expect(body.totals.totalCost).toBeCloseTo(0.3, 4);
  });

  it("zero consumption → every cost = 0 (no NaN)", async () => {
    app = await buildApp({
      equipments: [
        { id: "meter-1", name: "Compteur", type: "main_energy_meter" },
        { id: "sub-A", name: "Cuisine", type: "energy_meter" },
      ],
      // No main, no submeter consumption data.
      tariff: TARIFF_20_10,
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.submeters[0].cost).toBe(0);
    expect(body.totals.totalCost).toBe(0);
    expect(body.totals.otherCost).toBe(0);
  });

  it("no main meter → submeter costs = 0 (no aggregate HP/HC available)", async () => {
    app = await buildApp({
      equipments: [{ id: "sub-A", name: "Cuisine", type: "energy_meter" }],
      submeterRowsById: {
        "sub-A": [{ _time: "2026-05-24T22:00:00Z", _value: 500, alias: "energy" }],
      },
      tariff: TARIFF_20_10,
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.submeters[0].cost).toBe(0);
    expect(body.totals.totalCost).toBe(0);
  });

  it("tariff missing → every cost = 0, request still succeeds", async () => {
    app = await buildApp({
      equipments: [
        { id: "meter-1", name: "Compteur", type: "main_energy_meter" },
        { id: "sub-A", name: "Cuisine", type: "energy_meter" },
      ],
      hpHcRows: [{ _time: "2026-05-24T22:00:00Z", _value: 1000, alias: "energy_hp" }],
      submeterRowsById: {
        "sub-A": [{ _time: "2026-05-24T22:00:00Z", _value: 500, alias: "energy" }],
      },
      mainConsumptionRows: [{ _time: "2026-05-24T22:00:00Z", _value: 1000, alias: "energy" }],
      // no tariff
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.submeters[0].cost).toBe(0);
    expect(body.totals.totalCost).toBe(0);
  });
});

describe("Spec 123 — /api/v1/energy/status tariffConfigured", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("false when no tariff set", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/energy/status" });
    expect(r.json().tariffConfigured).toBe(false);
  });

  it("false when prices are 0/0 even if schedules are set", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      tariff: {
        schedules: [{ days: [1], slots: [{ start: "00:00", end: "06:00", tariff: "hc" }] }],
        prices: { hp: 0, hc: 0 },
      },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/energy/status" });
    expect(r.json().tariffConfigured).toBe(false);
  });

  it("true when at least one price > 0", async () => {
    app = await buildApp({
      equipments: [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" }],
      tariff: { schedules: [], prices: { hp: 0.2, hc: 0 } },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/energy/status" });
    expect(r.json().tariffConfigured).toBe(true);
  });
});

// Issue #381 — the tariff GET carries prices and must be admin-only, like
// GET /api/v1/settings. The spec 131 gate only covers mutating methods.
describe("Issue #381 — GET /api/v1/settings/energy/tariff admin gate", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  const TARIFF: TariffConfig = {
    schedules: [
      { days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: "22:00", end: "06:00", tariff: "hc" }] },
    ],
    prices: { hp: 0.2516, hc: 0.2068 },
  };

  it("returns 403 to a standard user, without leaking prices", async () => {
    app = await buildApp({ tariff: TARIFF, authRole: "standard" });
    const r = await app.inject({ method: "GET", url: "/api/v1/settings/energy/tariff" });
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain("0.2516");
    expect(r.body).not.toContain("0.2068");
  });

  it("returns 403 when request.auth is absent", async () => {
    app = await buildApp({ tariff: TARIFF, authRole: null });
    const r = await app.inject({ method: "GET", url: "/api/v1/settings/energy/tariff" });
    expect(r.statusCode).toBe(403);
  });

  it("still returns the full config, prices included, to an admin", async () => {
    app = await buildApp({ tariff: TARIFF, authRole: "admin" });
    const r = await app.inject({ method: "GET", url: "/api/v1/settings/energy/tariff" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(TARIFF);
  });
});
