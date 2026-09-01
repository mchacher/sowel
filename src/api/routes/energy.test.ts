import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerEnergyRoutes } from "./energy.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";
import type {
  TariffConfig,
  ArbiterDailyHomeMetrics,
  ArbiterDailyLoadMetrics,
} from "../../shared/types.js";

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
    /** Spec 173 — "already counted by that meter". */
    meteringParentId?: string | null;
  }>;
  envTz?: string | undefined;
  /** Spec 160/161 — a stand-in forecaster, for the routes that need one. */
  pvForecaster?: unknown;
  /** Spec 123 — inject a tariff config for cost-wiring tests. */
  tariff?: TariffConfig | null;
  /** Issue #381 — role decorated on request.auth. Defaults to admin;
   *  null leaves request.auth undefined (unauthenticated). */
  authRole?: "admin" | "standard" | null;
  /** Spec 158 — stub the arbiter daily metrics store. Absent = not wired,
   *  which is the "arbiter never ran" case the route must answer politely. */
  arbiterMetrics?: {
    readLoads: () => Omit<ArbiterDailyLoadMetrics, "equipmentName">[];
    readHome: () => ArbiterDailyHomeMetrics[];
  } | null;
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

  // Mock EquipmentManager. Since #523 the by-usage route inspects each
  // non-excluded equipment's bindings for a numeric power/energy channel;
  // return one so the test's energy_meter submeters qualify (the excluded
  // main/production types never reach this fetch).
  const equipments = opts.equipments ?? [];
  const equipmentManager = {
    getAll: () => equipments,
    getById: (id: string) => equipments.find((e) => e.id === id),
    getDataBindingsWithValues: () => [
      { alias: "power", category: "power", type: "number", value: 0 },
    ],
  } as never;

  // tariffClassifier returns the injected config (spec 123 — used for cost wiring).
  const tariffClassifier = { getConfig: () => opts.tariff ?? null } as never;
  // The tariff PUT writes through this; capture what it was handed so a test
  // can assert an accepted body actually reached the store.
  const settingsWrites: Array<[string, string]> = [];
  const settingsManager = {
    set: (key: string, value: string) => {
      settingsWrites.push([key, value]);
    },
  } as never;

  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  (app as unknown as { settingsWrites: typeof settingsWrites }).settingsWrites = settingsWrites;

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
    capacityArbiter: null,
    arbiterMetricsStore: (opts.arbiterMetrics ?? null) as never,
    // Spec 160 — the routes must answer sensibly with no forecaster at all.
    pvForecaster: (opts.pvForecaster ?? null) as never,
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

describe("Spec 173 — /api/v1/energy/by-usage with nested submeters", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });
  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  /** A gîte clamp, the water-heater clamp fed from it, and the house total. */
  const nested = (parent: string | null) => ({
    equipments: [
      { id: "gite", name: "ConsommationGite", type: "energy_meter" as const },
      {
        id: "ce",
        name: "ConsommationChauffeEau",
        type: "energy_meter" as const,
        meteringParentId: parent,
      },
      { id: "edf", name: "EDF", type: "main_energy_meter" as const },
    ],
    submeterRowsById: {
      gite: [{ _time: "2026-05-24T22:00:00Z", _value: 2260, alias: "energy" }],
      ce: [{ _time: "2026-05-24T22:00:00Z", _value: 2090, alias: "energy" }],
    },
    mainConsumptionRows: [{ _time: "2026-05-24T22:00:00Z", _value: 12330, alias: "energy" }],
  });

  const dayOne = (body: { submeters: { id: string; points: { wh: number }[] }[] }, id: string) =>
    body.submeters.find((s) => s.id === id)!.points[0].wh;

  it("counts the heater twice while nothing is declared", async () => {
    // The bug, written down: 2090 Wh in two slices, and a residual short by
    // exactly that much.
    app = await buildApp(nested(null));
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    expect(dayOne(body, "gite")).toBe(2260);
    expect(dayOne(body, "ce")).toBe(2090);
    expect(body.other.points[0].wh).toBe(12330 - 2260 - 2090);
  });

  it("renders the parent net of its child once the declaration is made", async () => {
    app = await buildApp(nested("gite"));
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    expect(dayOne(body, "gite")).toBe(170); // 2260 − 2090
    expect(dayOne(body, "ce")).toBe(2090); // the child keeps its whole measurement
    // The residual regains the kilowatt-hours the double count was eating.
    expect(body.other.points[0].wh).toBe(12330 - 170 - 2090);
  });

  it("flags only the series that actually lost something", async () => {
    app = await buildApp(nested("gite"));
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    const gite = body.submeters.find((s: { id: string }) => s.id === "gite");
    const ce = body.submeters.find((s: { id: string }) => s.id === "ce");
    expect(gite.netOfChildren).toBe(true);
    // The child is whole; claiming otherwise would send the UI explaining a
    // subtraction that never happened.
    expect(ce.netOfChildren).toBeUndefined();
  });

  it("carries the subtraction into the period totals", async () => {
    app = await buildApp(nested("gite"));
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    expect(body.totals.byEquipment.gite).toBe(170);
    expect(body.totals.byEquipment.ce).toBe(2090);
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

// ============================================================
// Spec 158 — GET /api/v1/energy/arbiter/metrics
// ============================================================

describe("Spec 158 — /api/v1/energy/arbiter/metrics", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  const localDayStr = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const loadRow = (day: string): Omit<ArbiterDailyLoadMetrics, "equipmentName"> => ({
    day,
    equipmentId: "pump",
    grants: 3,
    revokes: 2,
    shortCycles: 1,
    grantedS: 7200,
    pendingS: 600,
    unmanagedS: 0,
    suspendedS: 0,
  });

  const homeRow = (day: string): ArbiterDailyHomeMetrics => ({
    day,
    exportWh: 4200,
    importWh: 1300,
    waitingExportWh: 120,
    idleClaimableExportWh: 800,
    samples: 288,
  });

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("returns the rows over an explicit range, with names resolved", async () => {
    app = await buildApp({
      equipments: [{ id: "pump", name: "Pool pump", type: "energy_meter" }],
      arbiterMetrics: {
        readLoads: () => [loadRow("2026-08-20")],
        readHome: () => [homeRow("2026-08-20")],
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/arbiter/metrics?from=2026-08-01&to=2026-08-31",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.from).toBe("2026-08-01");
    expect(body.to).toBe("2026-08-31");
    expect(body.loads).toHaveLength(1);
    expect(body.loads[0].equipmentName).toBe("Pool pump");
    expect(body.loads[0].shortCycles).toBe(1);
    expect(body.home[0].exportWh).toBe(4200);
  });

  it("flags idleClaimableExportWh as an estimate", async () => {
    app = await buildApp({ arbiterMetrics: { readLoads: () => [], readHome: () => [] } });
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/arbiter/metrics" });
    expect(res.json().estimates).toContain("idleClaimableExportWh");
    expect(res.json().estimates).toContain("waitingExportWh");
  });

  it("falls back to the equipment id for a deleted equipment", async () => {
    app = await buildApp({
      equipments: [],
      arbiterMetrics: { readLoads: () => [loadRow("2026-08-20")], readHome: () => [] },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/energy/arbiter/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.json().loads[0].equipmentName).toBe("pump");
  });

  it("defaults to the last 30 days", async () => {
    app = await buildApp({ arbiterMetrics: { readLoads: () => [], readHome: () => [] } });
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/arbiter/metrics" });

    const body = res.json();
    const from = new Date(`${body.from}T12:00:00`);
    const to = new Date(`${body.to}T12:00:00`);
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    expect(days).toBe(29); // inclusive range of 30 days
  });

  it("rejects a malformed date", async () => {
    app = await buildApp({ arbiterMetrics: { readLoads: () => [], readHome: () => [] } });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/arbiter/metrics?from=hier&to=2026-08-31",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects from after to", async () => {
    app = await buildApp({ arbiterMetrics: { readLoads: () => [], readHome: () => [] } });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/arbiter/metrics?from=2026-08-31&to=2026-08-01",
    });
    expect(res.statusCode).toBe(400);
  });

  it("clamps an over-long span instead of rejecting it", async () => {
    app = await buildApp({ arbiterMetrics: { readLoads: () => [], readHome: () => [] } });
    const today = new Date();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/energy/arbiter/metrics?from=2000-01-01&to=${localDayStr(today)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.from).not.toBe("2000-01-01");
    // Clamped to the retention window counted back from TODAY.
    const expected = new Date(today);
    expected.setDate(expected.getDate() - 399);
    expect(body.from).toBe(localDayStr(expected));
  });

  it("anchors the clamp on today, not on `to` (a far-future `to` must not hide data)", async () => {
    // Anchoring on `to` pushed `from` FORWARD past every existing row and
    // answered 200 with empty arrays for a range that does have data.
    app = await buildApp({ arbiterMetrics: { readLoads: () => [], readHome: () => [] } });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/arbiter/metrics?from=2026-08-01&to=2099-01-01",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().from).toBe("2026-08-01");
  });

  it("rejects an impossible but well-shaped date", async () => {
    app = await buildApp({ arbiterMetrics: { readLoads: () => [], readHome: () => [] } });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/arbiter/metrics?from=2026-02-30&to=2026-03-31",
    });
    expect(res.statusCode).toBe(400);
  });

  it("answers with an empty payload when the arbiter never ran", async () => {
    app = await buildApp({ arbiterMetrics: null });
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/arbiter/metrics" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ home: [], loads: [] });
  });

  it("returns 500 rather than crashing when the store throws", async () => {
    app = await buildApp({
      arbiterMetrics: {
        readLoads: () => {
          throw new Error("db gone");
        },
        readHome: () => [],
      },
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/arbiter/metrics" });
    expect(res.statusCode).toBe(500);
  });
});

describe("PV forecast routes (spec 160)", () => {
  const solarMeter = {
    id: "eq-pv",
    name: "Shelly Solar",
    type: "energy_production_meter" as const,
  };

  it("404s on an unknown equipment", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/pv-forecast/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("answers with an inactive profile rather than an error when nothing is declared", async () => {
    const app = await buildApp({ equipments: [solarMeter] });
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/pv-forecast/eq-pv" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The panel needs "not set up yet", not "something went wrong".
    expect(body.active).toBe(false);
    expect(body.curve).toEqual([]);
    expect(body.model).toBeNull();
    expect(body.declaredPeakWc).toBe(0);
    await app.close();
  });

  it("reports the declared array once a profile is present", async () => {
    const declared = {
      ...solarMeter,
      solarProfile: { planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: 4000 }] },
    } as never;
    const app = await buildApp({ equipments: [declared] });
    const body = (
      await app.inject({ method: "GET", url: "/api/v1/energy/pv-forecast/eq-pv" })
    ).json();
    expect(body.active).toBe(true);
    expect(body.declaredPeakWc).toBe(4000);
    expect(body.planes).toHaveLength(1);
    await app.close();
  });
});

/**
 * The backfill route (spec 161).
 *
 * Each refusal is something different for the household to do — update the
 * plugin, declare the array, wait for the database — so the route must keep
 * them apart rather than folding them into one failure.
 */
describe("Spec 161 — POST /energy/pv-forecast/:id/backfill", () => {
  const solarMeter = {
    id: "eq-pv",
    name: "Solaire",
    type: "energy_production_meter" as const,
  };

  const url = "/api/v1/energy/pv-forecast/eq-pv/backfill";

  /** A forecaster whose backfill returns exactly what the test wants. */
  const forecasterReturning = (report: unknown) => ({
    backfill: () => Promise.resolve(report),
    getModel: () => null,
    getCurve: () => [],
    getIssuedAt: () => null,
    getProductionAlias: () => null,
    hasIrradianceSeries: () => false,
  });

  it("reports the fit, the window and why it stopped there", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning({
        ok: true,
        hoursPaired: 640,
        windowFrom: "2026-07-11T00:00:00.000Z",
        windowTo: "2026-08-25T00:00:00.000Z",
        boundedBy: "window",
        model: { gain: 3.8, shape: { 12: 1 }, fittedAt: "2026-08-25T00:00:00.000Z", samples: 640 },
      }),
    });
    const res = await app.inject({ method: "POST", url });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hoursPaired).toBe(640);
    expect(body.boundedBy).toBe("window");
    expect(body.model.gain).toBe(3.8);
    await app.close();
  });

  it("returns a null model, not an error, when there is still too little history", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning({
        ok: true,
        hoursPaired: 40,
        boundedBy: "declaration",
        model: null,
        reason: "not-enough-history",
      }),
    });
    const res = await app.inject({ method: "POST", url });
    // The samples were still written; this is progress, not a failure.
    expect(res.statusCode).toBe(200);
    expect(res.json().model).toBeNull();
    expect(res.json().reason).toBe("not-enough-history");
    await app.close();
  });

  it("refuses with 400 when no array is declared", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning({ ok: false, reason: "no-profile" }),
    });
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(400);
    await app.close();
  });

  it("refuses with 409 when no plugin publishes the history", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning({ ok: false, reason: "no-history" }),
    });
    const res = await app.inject({ method: "POST", url });
    expect(res.statusCode).toBe(409);
    // Named, so the panel can tell the owner to update the plugin rather than
    // to keep waiting.
    expect(res.json().reason).toBe("no-history");
    await app.close();
  });

  it("refuses with 503 when the database cannot be reached", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning({ ok: false, reason: "influx-unavailable" }),
    });
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(503);
    await app.close();
  });

  it("answers 404 for an unknown equipment", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning({ ok: true, hoursPaired: 0, model: null }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/energy/pv-forecast/nope/backfill",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("refuses a non-admin before touching the forecaster", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      authRole: "standard",
      pvForecaster: forecasterReturning({ ok: true, hoursPaired: 999, model: null }),
    });
    const res = await app.inject({ method: "POST", url });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("answers 503 with no forecaster wired at all", async () => {
    const app = await buildApp({ equipments: [solarMeter] });
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(503);
    await app.close();
  });
});

/**
 * The health route (spec 162).
 *
 * The shape that matters: an installation with no qualifying day yet gets an
 * empty series, never a 404. Nothing to show is a state of the feature.
 */
describe("Spec 162 — GET /energy/pv-health/:id", () => {
  const solarMeter = {
    id: "eq-pv",
    name: "Solaire",
    type: "energy_production_meter" as const,
  };
  const url = "/api/v1/energy/pv-health/eq-pv";

  const forecasterReturning = (health: unknown) => ({
    getHealth: () => health,
    getStandingHealthAlerts: () => [],
    getModel: () => null,
    getCurve: () => [],
    getIssuedAt: () => null,
    getProductionAlias: () => null,
    hasIrradianceSeries: () => false,
  });

  const empty = {
    days: [],
    normal: null,
    latest: null,
    alert: null,
    detection: null,
    sinceCutoff: null,
  };

  it("returns an empty series rather than 404 when nothing qualifies yet", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning(empty),
    });
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toEqual([]);
    expect(res.json().detection).toBeNull();
    // FR6 — no declared array: the card must render nothing, not a "waiting for
    // clear hours" promise that can never come true.
    expect(res.json().active).toBe(false);
    await app.close();
  });

  it("ships the building-progress fields: target and capacity cutoff (#724)", async () => {
    // While the reference builds, the card says "N of M clear days since
    // <date>". M and the date come from the server so the display cannot
    // drift from the actual rule.
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning({ ...empty, sinceCutoff: "2026-08-05" }),
    });
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    expect(res.json().normalTarget).toBe(30);
    expect(res.json().sinceCutoff).toBe("2026-08-05");
    await app.close();
  });

  it("lists standing alerts for the client's banner rebuild", async () => {
    // The raise event fires exactly once; a session opened after it has no
    // event to catch and rebuilds from this snapshot, as battery alerts do.
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: {
        ...forecasterReturning(empty),
        getStandingHealthAlerts: () => [
          { equipmentId: "eq-pv", since: "2026-08-22", deficit: 0.25 },
        ],
      },
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/pv-health-alerts" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].deficit).toBe(0.25);
    expect(body[0].equipmentName).toBe("Solaire");
    await app.close();
  });

  it("answers an empty alert list with no forecaster wired", async () => {
    const app = await buildApp({ equipments: [solarMeter] });
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/pv-health-alerts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it("reports the series, the normal and the detection speed", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning({
        days: [{ day: "2026-08-24", ratio: 3.8, hours: 6, measuredWh: 1, irradiationWhM2: 1 }],
        normal: 3.8,
        latest: { day: "2026-08-24", ratio: 3.8, hours: 6, measuredWh: 1, irradiationWhM2: 1 },
        alert: null,
        detection: {
          minDetectableLoss: 0.1,
          calendarDays: 6,
          qualifyingDays: 8,
          windowDays: 14,
        },
      }),
    });
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    expect(res.json().normal).toBe(3.8);
    expect(res.json().detection.calendarDays).toBe(6);
    expect(res.json().detection.minDetectableLoss).toBe(0.1);
    await app.close();
  });

  it("carries the alert when there is one", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning({
        ...empty,
        alert: { since: "2026-08-22", deficit: 0.25 },
      }),
    });
    expect((await app.inject({ method: "GET", url })).json().alert.deficit).toBe(0.25);
    await app.close();
  });

  it("answers 404 for an unknown equipment", async () => {
    const app = await buildApp({
      equipments: [solarMeter],
      pvForecaster: forecasterReturning(empty),
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/pv-health/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("answers 503 with no forecaster wired", async () => {
    const app = await buildApp({ equipments: [solarMeter] });
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(503);
    await app.close();
  });
});

// ============================================================
// Spec 165 review — GET /api/v1/energy/arbiter with no arbiter wired
// ============================================================

describe("Spec 165 review — /api/v1/energy/arbiter fallback", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("answers the full ArbiterPublicState shape, arrays included", async () => {
    // The harness wires `capacityArbiter: null`, which is the "arbiter never
    // started" case. The literal used to omit the fields added after it
    // (`loads`, `dormant`, `idle`, `priority`), and the inferred return type
    // hid that from tsc. The UI only survived it by returning early on
    // `enabled: false`; anything mapping over `loads` first would throw.
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/arbiter" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body.state).toBe("disabled");
    expect(body.dormant).toBe(false);
    expect(body.availableSurplusW).toBeNull();
    expect(body.productionDetected).toBe(false);
    for (const key of [
      "loads",
      "grants",
      "pending",
      "suspensions",
      "idle",
      "priority",
      "journal",
      "surplusSeries",
    ]) {
      expect(Array.isArray(body[key]), `${key} must be an array`).toBe(true);
      expect(body[key]).toHaveLength(0);
    }
  });
});

// ── PUT /api/v1/settings/energy/tariff — #597, #482 Lot C ──
//
// Characterization first: every expectation below was produced by running
// against the hand-rolled nested validation, BEFORE the schema replaced it.
// The route had no test of its own, and "zero behavioural regression" is only
// worth something if the behaviour was written down first.
//
// Admin gating is NOT a route concern here and is deliberately not asserted:
// this PUT is absent from STANDARD_WRITE_ALLOWLIST, so the global fail-closed
// role gate refuses a non-admin in an onRequest hook, before any of this runs.
// The GET beside it needs its own check and has one, because that gate covers
// only mutating methods.
describe("PUT /api/v1/settings/energy/tariff", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const URL = "/api/v1/settings/energy/tariff";

  const VALID = {
    schedules: [{ days: [1, 2, 3, 4, 5], slots: [{ start: "22:00", end: "06:00", tariff: "hc" }] }],
    prices: { hp: 0.27, hc: 0.2 },
  };

  afterEach(async () => {
    if (app) await app.close();
  });

  const writes = () =>
    (app as unknown as { settingsWrites: Array<[string, string]> }).settingsWrites;

  it("accepts a well-formed config and stores it", async () => {
    app = await buildApp({});
    const res = await app.inject({ method: "PUT", url: URL, payload: VALID });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe("energy.tariff");
    expect(JSON.parse(writes()[0][1])).toEqual(VALID);
  });

  it("accepts an empty schedule list", async () => {
    app = await buildApp({});
    const res = await app.inject({
      method: "PUT",
      url: URL,
      payload: { schedules: [], prices: { hp: 0, hc: 0 } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("accepts every weekday index, and both tariff bands", async () => {
    app = await buildApp({});
    const res = await app.inject({
      method: "PUT",
      url: URL,
      payload: {
        schedules: [
          { days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: "00:00", end: "24:00", tariff: "hp" }] },
        ],
        prices: { hp: 0.27, hc: 0.2 },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  const rejects: [string, unknown][] = [
    ["no body", undefined],
    ["missing schedules", { prices: { hp: 1, hc: 1 } }],
    ["schedules not an array", { schedules: {}, prices: { hp: 1, hc: 1 } }],
    ["missing prices", { schedules: [] }],
    ["prices null", { schedules: [], prices: null }],
    ["hp not a number", { schedules: [], prices: { hp: "0.27", hc: 0.2 } }],
    ["hc missing", { schedules: [], prices: { hp: 0.27 } }],
    ["schedule without days", { schedules: [{ slots: [] }], prices: { hp: 1, hc: 1 } }],
    ["schedule without slots", { schedules: [{ days: [1] }], prices: { hp: 1, hc: 1 } }],
    ["day below range", { schedules: [{ days: [-1], slots: [] }], prices: { hp: 1, hc: 1 } }],
    ["day above range", { schedules: [{ days: [7], slots: [] }], prices: { hp: 1, hc: 1 } }],
    ["day not a number", { schedules: [{ days: ["1"], slots: [] }], prices: { hp: 1, hc: 1 } }],
    [
      "slot without start",
      {
        schedules: [{ days: [1], slots: [{ end: "06:00", tariff: "hc" }] }],
        prices: { hp: 1, hc: 1 },
      },
    ],
    [
      "slot without end",
      {
        schedules: [{ days: [1], slots: [{ start: "22:00", tariff: "hc" }] }],
        prices: { hp: 1, hc: 1 },
      },
    ],
    [
      "slot with an unknown band",
      {
        schedules: [{ days: [1], slots: [{ start: "22:00", end: "06:00", tariff: "hx" }] }],
        prices: { hp: 1, hc: 1 },
      },
    ],
  ];

  // Declared changes, found by running the same 51 bodies through the old
  // validation and the new schema and diffing the verdicts. Nothing else
  // flipped.
  it("400s a fractional weekday (tightening, #597)", async () => {
    // `typeof day === "number"` accepted 2.5, a value getDay() can never
    // equal, so the schedule silently matched no day at all.
    app = await buildApp({});
    const res = await app.inject({
      method: "PUT",
      url: URL,
      payload: { schedules: [{ days: [2.5], slots: [] }], prices: { hp: 1, hc: 1 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s a non-string slot bound (tightening, #597)", async () => {
    // `!slot.start` accepted any truthy value, so `5`, `true`, `{}` and `[]`
    // all reached the classifier as a time of day.
    app = await buildApp({});
    for (const start of [5, true, {}, []]) {
      const res = await app.inject({
        method: "PUT",
        url: URL,
        payload: {
          schedules: [{ days: [1], slots: [{ start, end: "06:00", tariff: "hc" }] }],
          prices: { hp: 1, hc: 1 },
        },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("400s an infinite price that used to be silently stored as null", async () => {
    // JSON.stringify(Infinity) is "null", so an overflowing literal was
    // accepted and written as `"hp": null` into energy.tariff, poisoning every
    // cost computation until someone happened to re-save the form. ajv's
    // `number` is finite. Sent as raw JSON because the literal cannot be
    // written in TypeScript source without losing precision.
    app = await buildApp({});
    const res = await app.inject({
      method: "PUT",
      url: URL,
      headers: { "content-type": "application/json" },
      body: '{"schedules":[],"prices":{"hp":1e999,"hc":0.2}}',
    });
    expect(res.statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("400s a null slot entry that used to crash the handler", async () => {
    app = await buildApp({});
    const res = await app.inject({
      method: "PUT",
      url: URL,
      payload: { schedules: [{ days: [1], slots: [null] }], prices: { hp: 1, hc: 1 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s a null schedule entry that used to crash the handler", async () => {
    // `schedule.days` on null threw, so this answered 500.
    app = await buildApp({});
    const res = await app.inject({
      method: "PUT",
      url: URL,
      payload: { schedules: [null], prices: { hp: 1, hc: 1 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("still ignores unknown fields, as it always did", async () => {
    app = await buildApp({});
    const res = await app.inject({
      method: "PUT",
      url: URL,
      payload: { schedules: [], prices: { hp: 1, hc: 1, extra: 9 }, extra: "ignored" },
    });
    expect(res.statusCode).toBe(200);
  });

  for (const [name, payload] of rejects) {
    it(`400s on ${name}`, async () => {
      app = await buildApp({});
      const res = await app.inject({ method: "PUT", url: URL, payload: payload as never });
      expect(res.statusCode).toBe(400);
      const body = res.json() as Record<string, unknown>;
      // The `{ error }` shape #482 exists to preserve, not Fastify's own
      // `{ statusCode, code, error, message }` envelope.
      expect(typeof body.error).toBe("string");
      expect(body.statusCode).toBeUndefined();
      expect(body.code).toBeUndefined();
      expect(writes()).toHaveLength(0);
    });
  }
});
