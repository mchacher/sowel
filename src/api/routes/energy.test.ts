import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerEnergyRoutes } from "./energy.js";

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

  // tariffClassifier and settingsManager are unused by /history and /by-usage.
  const tariffClassifier = { getConfig: () => null } as never;
  const settingsManager = {} as never;

  const app = Fastify({ logger: false });
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
