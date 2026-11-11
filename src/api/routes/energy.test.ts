import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerEnergyRoutes, trimToWindow, SUBMETER_PALETTE } from "./energy.js";
import { EMPTY_ACCURACY } from "../../energy/pv/pv-accuracy.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";
import { TariffVersionStore } from "../../energy/tariff-version-store.js";
import { PriceFileSync } from "../../energy/price-file/price-file-sync.js";
import { CONTRACT_SETTING_KEY, resolveContract } from "../../energy/pricing.js";
import { createMigratedTestDb } from "../../test-helpers/migrations.js";
import type {
  TariffConfig,
  TariffVersionInput,
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
  /** Spec 202 — HP/HC rows per Flux window (`1mo`, `1d`…), for a route that
   *  reads the same range at two resolutions. Falls back on `hpHcRows`. */
  hpHcRowsByEvery?: Record<string, PreparedRow[]>;
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
    /** Spec 179 — fed by a separate supply. */
    separateSupply?: boolean;
    /** Spec 195 — negative power is local production. */
    localProduction?: boolean;
  }>;
  /** Every Flux query the route ran, in order. */
  fluxLog?: string[];
  /** Bindings per equipment id; the rest get one numeric `power` binding. */
  bindingsById?: Record<string, Array<{ alias: string; category: string; type: string }>>;
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
  /** Spec 203 — what the price file download answers. Absent = no price file sync wired. */
  priceFile?: unknown;
  /** Spec 202 — dated versions created after the one seeded from `tariff`. */
  versions?: TariffVersionInput[];
  /** Spec 200 — stub the arbiter gain store and meter. Spec 202: a row may
   *  carry Wh in HP/HC (priced at read time) instead of booked euros. */
  arbiterGain?: {
    rows: GainRowInput[];
    pending?: GainRowInput[];
    since: string | null;
  };
  /** Settings the route reads (spec 200 — `energy.arbiter.enabled`). */
  settings?: Record<string, string>;
  /** Spec 200 — no InfluxDB configured. */
  noInflux?: boolean;
}

interface GainRowInput {
  day: string;
  equipmentId: string;
  solarWh: number;
  avoidedEur: number;
  solarHpWh?: number;
  solarHcWh?: number;
}

function gainRow(r: GainRowInput) {
  return { solarHpWh: 0, solarHcWh: 0, ...r };
}

async function buildApp(opts: BuildOpts = {}) {
  // Mock InfluxClient: getClient() returns an object whose
  // getQueryApi(org).iterateRows(flux) yields prepared rows.  Each
  // route invocation pulls from the prepared lists in order of the
  // helper calls; we route by inspecting the flux's alias filter.
  const influxClient = {
    getConfig: () => (opts.noInflux ? null : { bucket: "sowel", org: "sowel" }),
    getClient: () =>
      ({
        getQueryApi: () => ({
          iterateRows: async function* (flux: string) {
            opts.fluxLog?.push(flux);
            // Route by the alias filter the Flux query embeds.
            let rows: PreparedRow[] = [];
            if (
              flux.includes(
                'r.alias == "energy_hp" or r.alias == "energy_hc" or r.alias == "energy"',
              )
            ) {
              rows = opts.mainConsumptionRows ?? [];
            } else if (flux.includes('r.alias == "energy_hp" or r.alias == "energy_hc"')) {
              const every = flux.match(/every: (\w+)/)?.[1] ?? "";
              rows = opts.hpHcRowsByEvery?.[every] ?? opts.hpHcRows ?? [];
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
    getDataBindingsWithValues: (id: string) =>
      opts.bindingsById?.[id] ?? [{ alias: "power", category: "power", type: "number", value: 0 }],
  } as never;

  // tariffClassifier returns the injected config (spec 123 — used for cost wiring).
  const tariffClassifier = { getConfig: () => opts.tariff ?? null } as never;
  // The tariff PUT writes through this; capture what it was handed so a test
  // can assert an accepted body actually reached the store.
  const settingsWrites: Array<[string, string]> = [];
  const settings = new Map(Object.entries(opts.settings ?? {}));
  const settingsManager = {
    get: (key: string) => settings.get(key),
    set: (key: string, value: string) => {
      settingsWrites.push([key, value]);
      settings.set(key, value);
    },
  } as never;

  // Spec 202 — the real version store on a migrated in-memory database, set up
  // as the startup does: the first version from the legacy setting's prices,
  // then whatever dated versions the test adds.
  const tariffVersions = new TariffVersionStore(createMigratedTestDb(), logger);
  tariffVersions.seedFromSetting(opts.tariff ?? null);
  for (const version of opts.versions ?? []) tariffVersions.create(version, "manual");

  // Spec 203 — the real sync, its download replaced by the test's file.
  let priceFileFetches = 0;
  const priceFileSync =
    opts.priceFile === undefined
      ? null
      : new PriceFileSync({
          settings: settingsManager,
          versions: tariffVersions,
          contract: () =>
            resolveContract(
              settings.get(CONTRACT_SETTING_KEY),
              opts.tariff ?? null,
              tariffVersions.all(),
            ),
          eventBus: { emit: () => undefined },
          logger,
          fetchFile: async () => {
            priceFileFetches++;
            return opts.priceFile;
          },
        });

  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  (app as unknown as { settingsWrites: typeof settingsWrites }).settingsWrites = settingsWrites;
  (app as unknown as { tariffVersions: TariffVersionStore }).tariffVersions = tariffVersions;
  (app as unknown as { priceFileFetches: () => number }).priceFileFetches = () => priceFileFetches;

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
    tariffVersions,
    priceFileSync,
    capacityArbiter: null,
    arbiterMetricsStore: (opts.arbiterMetrics ?? null) as never,
    arbiterGain: opts.arbiterGain
      ? ({
          store: {
            range: (from: string, to: string) =>
              opts.arbiterGain!.rows.filter((r) => r.day >= from && r.day <= to).map(gainRow),
          },
          meter: {
            pending: () => (opts.arbiterGain!.pending ?? []).map(gainRow),
            since: () => opts.arbiterGain!.since,
          },
        } as never)
      : null,
    // Spec 160 — the routes must answer sensibly with no forecaster at all.
    pvForecaster: (opts.pvForecaster ?? null) as never,
    logger,
  });
  await app.ready();
  return app;
}

describe("Spec 195 — /api/v1/energy/history counts local production", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  const equipments = (localProduction: boolean) => [
    { id: "meter-1", name: "Compteur", type: "main_energy_meter" as const },
    { id: "pv", name: "Solaire", type: "energy_production_meter" as const },
    { id: "piscine", name: "Piscine", type: "energy_meter" as const, localProduction },
  ];

  it("adds a flagged submeter's `production` to the production total", async () => {
    const fluxLog: string[] = [];
    app = await buildApp({
      equipments: equipments(true),
      fluxLog,
      productionRows: [
        { _time: "2026-05-30T10:00:00Z", _value: 3000, alias: "energy" },
        { _time: "2026-05-30T10:00:00Z", _value: 400, alias: "production" },
        { _time: "2026-05-30T10:00:00Z", _value: 2900, alias: "autoconso" },
        { _time: "2026-05-30T10:00:00Z", _value: 500, alias: "injection" },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=day&date=2026-05-30",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totals.total_production).toBe(3400);
    const prodFlux = fluxLog.find((f) => f.includes('r.alias == "autoconso"'));
    // Only the flagged meter's `production` series — never its `energy`, which
    // is the pool's consumption.
    expect(prodFlux).toContain('(r.equipmentId == "piscine" and r.alias == "production")');
  });

  it("keeps reading past production once the flag is removed", async () => {
    // The autoconso written while it was ticked still holds that production;
    // dropping the series would leave the past with autoconso > production.
    const fluxLog: string[] = [];
    app = await buildApp({ equipments: equipments(false), fluxLog });

    await app.inject({ method: "GET", url: "/api/v1/energy/history?period=day&date=2026-05-30" });
    const prodFlux = fluxLog.find((f) => f.includes('r.alias == "autoconso"'));
    expect(prodFlux).toContain('(r.equipmentId == "piscine" and r.alias == "production")');
  });

  it("never reads a device series that happens to be named `production`", async () => {
    const fluxLog: string[] = [];
    app = await buildApp({
      equipments: equipments(true),
      fluxLog,
      bindingsById: {
        piscine: [{ alias: "production", category: "energy", type: "number" }],
      },
    });

    await app.inject({ method: "GET", url: "/api/v1/energy/history?period=day&date=2026-05-30" });
    const prodFlux = fluxLog.find((f) => f.includes('r.alias == "autoconso"'));
    expect(prodFlux).toBeDefined();
    expect(prodFlux).not.toContain("piscine");
  });
});

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

describe("Spec 196 (FR-E) — by-usage series carry a colorIndex", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });
  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  // The `color` every API client received before spec 196, by index. Spelled
  // out rather than imported, so a change to the server list fails here.
  const LEGACY_COLORS = [
    "#60A5FA",
    "#34D399",
    "#F87171",
    "#A78BFA",
    "#22D3EE",
    "#FB7185",
    "#FBBF24",
    "#818CF8",
  ];

  it("gives each series its sorted index, and keeps the pre-196 colour beside it", async () => {
    app = await buildApp({
      // Declared out of order: the index follows the id sort, then the
      // separate-supply meters after the partition.
      equipments: [
        { id: "sub-C", name: "Garage", type: "energy_meter" },
        { id: "sub-A", name: "Cuisine", type: "energy_meter" },
        { id: "ev", name: "Borne", type: "energy_meter", separateSupply: true },
        { id: "sub-B", name: "Salon", type: "energy_meter" },
      ],
    });
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    const index = (list: { id: string; colorIndex: number; color: string }[]) =>
      list.map((s) => [s.id, s.colorIndex, s.color]);
    expect(index(body.submeters)).toEqual([
      ["sub-A", 0, "#60A5FA"],
      ["sub-B", 1, "#34D399"],
      ["sub-C", 2, "#F87171"],
    ]);
    expect(index(body.separateSupply)).toEqual([["ev", 3, "#A78BFA"]]);
  });

  it("keeps `color` on the pre-196 palette, at the entry colorIndex names", async () => {
    expect(SUBMETER_PALETTE).toEqual(LEGACY_COLORS);
    // Ten meters: the index keeps counting, the colour wraps after eight.
    const ids = Array.from({ length: 10 }, (_, i) => `m-${String(i).padStart(2, "0")}`);
    app = await buildApp({ equipments: ids.map((id) => ({ id, name: id, type: "energy_meter" })) });
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();
    const series = body.submeters as { id: string; colorIndex: number; color: string }[];
    expect(series.map((s) => s.colorIndex)).toEqual(ids.map((_, i) => i));
    for (const s of series) expect(s.color, s.id).toBe(LEGACY_COLORS[s.colorIndex % 8]);
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

  it("does not flag a parent whose child reported nothing", async () => {
    const data = nested("gite");
    data.submeterRowsById.ce = [];
    app = await buildApp(data);
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    const gite = body.submeters.find((s: { id: string }) => s.id === "gite");
    // The declaration stands, but nothing was taken off: the figure equals the
    // card, and a legend saying otherwise sends the reader hunting a difference
    // that is not on screen.
    expect(gite.netOfChildren).toBeUndefined();
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

describe("Spec 179 — /api/v1/energy/by-usage with a separate-supply meter", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });
  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  /** A gîte clamp on the house network, an EV clamp on a second supply, and
   *  the house total. The EV's 3 kWh were never in the 12.33 kWh total. */
  const withEv = (evSeparate: boolean) => ({
    equipments: [
      { id: "gite", name: "ConsommationGite", type: "energy_meter" as const },
      {
        id: "ve",
        name: "ConsommationVE",
        type: "energy_meter" as const,
        separateSupply: evSeparate,
      },
      { id: "edf", name: "EDF", type: "main_energy_meter" as const },
    ],
    submeterRowsById: {
      gite: [{ _time: "2026-05-24T22:00:00Z", _value: 2260, alias: "energy" }],
      ve: [{ _time: "2026-05-24T22:00:00Z", _value: 3000, alias: "energy" }],
    },
    mainConsumptionRows: [{ _time: "2026-05-24T22:00:00Z", _value: 12330, alias: "energy" }],
  });

  it("eats the residual while nothing is declared", async () => {
    // The bug, written down: 3 kWh the main meter never carried land in the
    // partition, and `other` is short by exactly that much.
    app = await buildApp(withEv(false));
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    expect(body.other.points[0].wh).toBe(12330 - 2260 - 3000);
    expect(body.separateSupply).toBeUndefined();
  });

  it("leaves the partition and comes back apart once declared", async () => {
    app = await buildApp(withEv(true));
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    // The partition returns to what it was before the meter existed.
    expect(body.submeters.map((s: { id: string }) => s.id)).toEqual(["gite"]);
    expect(body.other.points[0].wh).toBe(12330 - 2260);
    expect(body.totals.byEquipment.ve).toBeUndefined();

    // The measurement is not lost: raw series, same always-N zero-fill.
    expect(body.separateSupply).toHaveLength(1);
    const ve = body.separateSupply[0];
    expect(ve.id).toBe("ve");
    expect(ve.points[0].wh).toBe(3000);
    expect(ve.points).toHaveLength(body.submeters[0].points.length);
  });

  it("never costs another supply's kilowatt-hours", async () => {
    // Spec 123's blended €/kWh is the MAIN meter's tariff; pricing the EV with
    // it is exactly the error the flag exists to stop.
    app = await buildApp({ ...withEv(true), tariff: TARIFF_20_10 });
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    expect(body.separateSupply[0].cost).toBe(0);
    expect(body.totals.costByEquipment.ve).toBeUndefined();
  });

  it("renders a containment child whole when its parent goes separate", async () => {
    // FR-5 — the declaration is kept but stops being used: the parent left the
    // partition, so there is nothing to subtract the child from.
    const base = withEv(true);
    app = await buildApp({
      ...base,
      equipments: [
        ...base.equipments,
        {
          id: "borne",
          name: "BorneDetail",
          type: "energy_meter" as const,
          meteringParentId: "ve",
        },
      ],
      submeterRowsById: {
        ...base.submeterRowsById,
        borne: [{ _time: "2026-05-24T22:00:00Z", _value: 500, alias: "energy" }],
      },
    });
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    const borne = body.submeters.find((s: { id: string }) => s.id === "borne");
    expect(borne.points[0].wh).toBe(500);
    expect(borne.netOfChildren).toBeUndefined();
  });

  it("stops subtracting a child that goes separate from its partition parent", async () => {
    // The other direction of FR-5: gite ⊃ ce was declared, then the ce clamp
    // moved to another supply. Its declaration is stored but inert — the
    // parent must render raw again, not net of watts that left the network.
    app = await buildApp({
      equipments: [
        { id: "gite", name: "ConsommationGite", type: "energy_meter" as const },
        {
          id: "ce",
          name: "ConsommationChauffeEau",
          type: "energy_meter" as const,
          meteringParentId: "gite",
          separateSupply: true,
        },
        { id: "edf", name: "EDF", type: "main_energy_meter" as const },
      ],
      submeterRowsById: {
        gite: [{ _time: "2026-05-24T22:00:00Z", _value: 2260, alias: "energy" }],
        ce: [{ _time: "2026-05-24T22:00:00Z", _value: 2090, alias: "energy" }],
      },
      mainConsumptionRows: [{ _time: "2026-05-24T22:00:00Z", _value: 12330, alias: "energy" }],
    });
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    const gite = body.submeters.find((s: { id: string }) => s.id === "gite");
    expect(gite.points[0].wh).toBe(2260);
    expect(gite.netOfChildren).toBeUndefined();
    expect(body.separateSupply[0].id).toBe("ce");
  });

  it("keeps the group out of the no-main-meter fallback total", async () => {
    const data = withEv(true);
    data.equipments = data.equipments.filter((e) => e.type !== "main_energy_meter");
    app = await buildApp(data);
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    // A total that summed both supplies would describe no meter at all.
    expect(body.totals.total).toBe(2260);
    expect(body.separateSupply[0].points[0].wh).toBe(3000);
  });

  it("hands every meter to the group when all of them are separate", async () => {
    const data = withEv(true);
    data.equipments = data.equipments.map((e) =>
      e.type === "energy_meter" ? { ...e, separateSupply: true } : e,
    );
    app = await buildApp(data);
    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();

    expect(body.submeters).toEqual([]);
    expect(body.other.points[0].wh).toBe(12330);
    expect(body.separateSupply).toHaveLength(2);
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

// Spec 202 — the costs are now per point (each bucket at the main meter's
// blended price of that bucket). With a single bucket, as here, that is the
// period-blended rate of spec 123, so these figures did not move.
describe("Spec 123 — /api/v1/energy/by-usage cost valuation", () => {
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

// ============================================================
// Issue #907 — the accuracy window is a statistic, the chart window is a zoom.
// ============================================================

describe("Issue #907 — trimming the accuracy payload to the chart window", () => {
  const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

  const accuracy = {
    ...EMPTY_ACCURACY,
    samples: 3,
    maeW: 50,
    dailyMaeWh: 1150,
    dailyMaePct: 5.2,
    dailyDays: 9,
    today: { day: "2026-09-05", forecastWh: 23_000, actualWh: 23_350, hours: 18 },
    points: [
      { at: hoursAgo(200), forecastW: 100, actualW: 90 },
      { at: hoursAgo(40), forecastW: 200, actualW: 190 },
      { at: hoursAgo(2), forecastW: 300, actualW: 290 },
    ],
    measured: [
      { at: hoursAgo(200), watts: 90 },
      { at: hoursAgo(2), watts: 290 },
    ],
  };

  it("drops the hours the chart will not draw", () => {
    const trimmed = trimToWindow(accuracy, 1);

    expect(trimmed.points).toHaveLength(1);
    expect(trimmed.measured).toHaveLength(1);
  });

  it("keeps the aggregates whole, which is the point of scoring wider than the zoom", () => {
    // A one-day zoom has at most one complete day to score, usually none. If
    // trimming took the aggregates with it, the headline would blank exactly
    // when the household zoomed in to look at it.
    const trimmed = trimToWindow(accuracy, 1);

    expect(trimmed.dailyMaeWh).toBe(1150);
    expect(trimmed.dailyDays).toBe(9);
    expect(trimmed.today?.hours).toBe(18);
  });

  it("keeps everything when the window covers it", () => {
    expect(trimToWindow(accuracy, 30).points).toHaveLength(3);
  });

  it("keeps an unparseable stamp rather than silently dropping a point", () => {
    const odd = { ...accuracy, points: [{ at: "not-a-date", forecastW: 1, actualW: 1 }] };
    expect(trimToWindow(odd, 1).points).toHaveLength(1);
  });
});

describe("Spec 200 — /api/v1/energy/bilan", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  const tariff: TariffConfig = {
    schedules: [
      { days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: "00:00", end: "00:00", tariff: "hp" }] },
    ],
    prices: { hp: 0.2, hc: 0.1 },
  };
  const equipments = [
    { id: "meter-1", name: "Compteur", type: "main_energy_meter" as const },
    { id: "sub-1", name: "Chauffe-eau", type: "energy_meter" as const },
  ];
  // Day rows (hourly, 30 May in Paris) and reference rows (daily, 28 and 29
  // May). The mock answers every query with the same rows; each read keeps
  // only its own buckets.
  const hpHcRows = [
    { _time: "2026-05-29T22:00:00Z", _value: 100, alias: "energy_hp" },
    { _time: "2026-05-29T23:00:00Z", _value: 120, alias: "energy_hp" },
    { _time: "2026-05-30T00:00:00Z", _value: 80, alias: "energy_hp" },
    { _time: "2026-05-27T22:00:00Z", _value: 10_000, alias: "energy_hp" },
    { _time: "2026-05-28T22:00:00Z", _value: 20_000, alias: "energy_hp" },
  ];

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("refuses the week period", async () => {
    app = await buildApp({ equipments, tariff });
    const res = await app.inject({ method: "GET", url: "/api/v1/energy/bilan?period=week" });
    expect(res.statusCode).toBe(400);
  });

  it("answers 404 without a main meter and 503 without InfluxDB", async () => {
    app = await buildApp({ equipments: [], tariff });
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/energy/bilan?period=day" })).statusCode,
    ).toBe(404);
    await app.close();
    app = await buildApp({ equipments, tariff, noInflux: true });
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/energy/bilan?period=day" })).statusCode,
    ).toBe(503);
  });

  it("gives the day's bill, the 7-day comparison and the arbiter gain", async () => {
    app = await buildApp({
      equipments,
      tariff,
      hpHcRows,
      arbiterGain: {
        rows: [
          { day: "2026-05-30", equipmentId: "sub-1", solarWh: 1000, avoidedEur: 0.2 },
          { day: "2026-05-29", equipmentId: "sub-1", solarWh: 9999, avoidedEur: 9 },
        ],
        // Not flushed yet: the read must add it.
        pending: [{ day: "2026-05-30", equipmentId: "sub-1", solarWh: 500, avoidedEur: 0.1 }],
        since: "2026-05-01",
      },
    });
    const history = await app.inject({
      method: "GET",
      url: "/api/v1/energy/history?period=day&date=2026-05-30",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/bilan?period=day&date=2026-05-30",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points).toHaveLength(24);
    expect(body.bill.total).toBe(history.json().totals.cost_total);
    expect(body.bill.total).toBeCloseTo(0.06, 6);
    expect(body.tariffConfigured).toBe(true);
    expect(body.hasProduction).toBe(false);
    expect(body.comparison).toEqual({ kind: "days", days: 2, averageBill: 3 });
    expect(body.arbiter).toMatchObject({
      enabled: false,
      since: "2026-05-01",
      measured: "full",
      avoided: 0.3,
      loads: [{ equipmentId: "sub-1", name: "Chauffe-eau", solarWh: 1500, avoided: 0.3 }],
    });
  });

  it("splits the day by usage, the rows' paid summing to the bill", async () => {
    app = await buildApp({
      equipments,
      tariff,
      hpHcRows,
      mainConsumptionRows: hpHcRows,
      submeterRowsById: {
        "sub-1": [{ _time: "2026-05-29T23:00:00Z", _value: 60, alias: "energy" }],
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/bilan?period=day&date=2026-05-30",
    });
    const body = res.json();
    const ids = body.usage.map((u: { id: string | null }) => u.id);
    expect(ids).toEqual([null, "sub-1"]);
    const paid = body.usage.reduce((s: number, u: { paid: number }) => s + u.paid, 0);
    expect(paid).toBeCloseTo(body.bill.total, 4);
  });

  it("reads 'not measured' for a period before the gain meter's first day", async () => {
    app = await buildApp({
      equipments,
      tariff,
      hpHcRows,
      settings: { "energy.arbiter.enabled": "true" },
      arbiterGain: { rows: [], since: "2026-11-10" },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/energy/bilan?period=day&date=2026-05-30",
    });
    expect(res.json().arbiter).toMatchObject({ enabled: true, measured: "none", avoided: 0 });
  });
});

// ============================================================
// Spec 202 — dated electricity prices
// ============================================================

/** A local midnight as Flux stamps a daily or monthly bucket. */
function localDay(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day).toISOString();
}

describe("Spec 202 — pricing by tariff version", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  const main = [{ id: "meter-1", name: "Compteur", type: "main_energy_meter" as const }];

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("prices each day of a month with the version in force that day, totals included", async () => {
    app = await buildApp({
      equipments: main,
      hpHcRows: [
        { _time: localDay(2026, 5, 14), _value: 1000, alias: "energy_hp" },
        { _time: localDay(2026, 5, 15), _value: 1000, alias: "energy_hp" },
      ],
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-05-15", prices: { hp: 0.3, hc: 0.1 } }],
    });

    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/history?period=month&date=2026-05-30",
      })
    ).json();
    expect(body.points[13].cost_total).toBe(0.2); // 14 May, before the change
    expect(body.points[14].cost_total).toBe(0.3); // 15 May, the day it starts
    expect(body.totals.cost_total).toBe(0.5);
  });

  it("prices a month crossed by a change from its days, in the year view", async () => {
    // January under the first version; March crossed on the 16th.
    const januaryDays = Array.from({ length: 10 }, (_, i) => ({
      _time: localDay(2026, 1, i + 1),
      _value: 1000,
      alias: "energy_hp",
    }));
    const marchDays = Array.from({ length: 31 }, (_, i) => ({
      _time: localDay(2026, 3, i + 1),
      _value: 1000,
      alias: "energy_hp",
    }));
    const fluxLog: string[] = [];
    app = await buildApp({
      equipments: main,
      fluxLog,
      hpHcRowsByEvery: {
        "1mo": [
          { _time: localDay(2026, 1, 1), _value: 10_000, alias: "energy_hp" },
          { _time: localDay(2026, 3, 1), _value: 31_000, alias: "energy_hp" },
        ],
        "1d": [...januaryDays, ...marchDays],
      },
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-03-16", prices: { hp: 0.3, hc: 0.1 } }],
    });

    const body = (
      await app.inject({ method: "GET", url: "/api/v1/energy/history?period=year&date=2026-06-01" })
    ).json();
    expect(body.points).toHaveLength(12);
    expect(body.points[0].cost_total).toBe(2); // January: 10 kWh at 0.20
    // March: 15 days at 0.20 and 16 days at 0.30.
    expect(body.points[2].cost_total).toBeCloseTo(15 * 0.2 + 16 * 0.3, 4);
    expect(body.totals.cost_total).toBeCloseTo(2 + 15 * 0.2 + 16 * 0.3, 4);
    expect(fluxLog.some((f) => f.includes("every: 1d"))).toBe(true);
  });

  it("reads no daily points for a year whose change falls on the 1st of a month", async () => {
    const fluxLog: string[] = [];
    app = await buildApp({
      equipments: main,
      fluxLog,
      hpHcRows: [
        { _time: localDay(2026, 2, 1), _value: 10_000, alias: "energy_hp" },
        { _time: localDay(2026, 3, 1), _value: 10_000, alias: "energy_hp" },
      ],
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-03-01", prices: { hp: 0.3, hc: 0.1 } }],
    });

    const body = (
      await app.inject({ method: "GET", url: "/api/v1/energy/history?period=year&date=2026-06-01" })
    ).json();
    expect(body.points[1].cost_total).toBe(2);
    expect(body.points[2].cost_total).toBe(3);
    expect(body.totals.cost_total).toBe(5);
    expect(fluxLog.some((f) => f.includes("every: 1d"))).toBe(false);
  });

  it("prices a meter that only runs off-peak at the off-peak price (by usage)", async () => {
    // Monday: the house consumes 1 kWh in peak hours. Tuesday: 1 kWh off-peak,
    // half of it by the sub-meter. The period-blended rate of spec 123 charged
    // the sub-meter 0.5 kWh × 0.15; point by point it costs 0.5 kWh × 0.10.
    const monday = localDay(2026, 5, 25);
    const tuesday = localDay(2026, 5, 26);
    app = await buildApp({
      equipments: [...main, { id: "sub-A", name: "Chauffe-eau", type: "energy_meter" }],
      hpHcRows: [
        { _time: monday, _value: 1000, alias: "energy_hp" },
        { _time: tuesday, _value: 1000, alias: "energy_hc" },
      ],
      submeterRowsById: { "sub-A": [{ _time: tuesday, _value: 500, alias: "energy" }] },
      mainConsumptionRows: [
        { _time: monday, _value: 1000, alias: "energy" },
        { _time: tuesday, _value: 1000, alias: "energy" },
      ],
      tariff: TARIFF_20_10,
    });

    const body = (
      await app.inject({
        method: "GET",
        url: "/api/v1/energy/by-usage?period=week&date=2026-05-30",
      })
    ).json();
    expect(body.submeters[0].cost).toBeCloseTo(0.05, 4);
    expect(body.totals.costByEquipment["sub-A"]).toBeCloseTo(0.05, 4);
    expect(body.totals.otherCost).toBeCloseTo(0.2 + 0.05, 4);
    expect(body.totals.totalCost).toBeCloseTo(0.3, 4);
  });

  it("prices a crossed month from its days in the Bilan year view, this year and the previous one", async () => {
    const days = (year: number, month: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        _time: localDay(year, month, i + 1),
        _value: 1000,
        alias: "energy_hp",
      }));
    app = await buildApp({
      equipments: main,
      hpHcRowsByEvery: {
        "1mo": [
          { _time: localDay(2025, 3, 1), _value: 31_000, alias: "energy_hp" },
          { _time: localDay(2026, 1, 1), _value: 10_000, alias: "energy_hp" },
          { _time: localDay(2026, 10, 1), _value: 31_000, alias: "energy_hp" },
        ],
        "1d": [...days(2025, 3, 31), ...days(2026, 1, 10), ...days(2026, 10, 31)],
      },
      tariff: TARIFF_20_10,
      versions: [
        { startDate: "2025-03-16", prices: { hp: 0.3, hc: 0.1 } }, // inside March 2025
        { startDate: "2026-10-16", prices: { hp: 0.4, hc: 0.1 } }, // inside October 2026
      ],
    });

    const body = (
      await app.inject({ method: "GET", url: "/api/v1/energy/bilan?period=year&date=2026-06-01" })
    ).json();
    // January 2026: one version, the monthly point as it is.
    expect(body.points[0].paidHp).toBeCloseTo(10 * 0.3, 4);
    // October 2026: 15 days at 0.30, 16 days at 0.40.
    expect(body.points[9].paidHp).toBeCloseTo(15 * 0.3 + 16 * 0.4, 4);
    expect(body.bill.total).toBeCloseTo(10 * 0.3 + 15 * 0.3 + 16 * 0.4, 4);
    // March 2025, the reference: priced from its own days, 15 at 0.20 and 16 at 0.30.
    expect(body.points[2].previousYearBill).toBeCloseTo(15 * 0.2 + 16 * 0.3, 4);
  });

  it("keeps the months a change does not touch on their monthly points in the year totals", async () => {
    // The daily rows of January disagree with its monthly row on purpose: a
    // change inside October must not move January's share of the total.
    app = await buildApp({
      equipments: main,
      hpHcRowsByEvery: {
        "1mo": [
          { _time: localDay(2026, 1, 1), _value: 10_000, alias: "energy_hp" },
          { _time: localDay(2026, 10, 1), _value: 2_000, alias: "energy_hp" },
        ],
        "1d": [
          { _time: localDay(2026, 1, 5), _value: 999, alias: "energy_hp" },
          { _time: localDay(2026, 10, 15), _value: 1000, alias: "energy_hp" },
          { _time: localDay(2026, 10, 16), _value: 1000, alias: "energy_hp" },
        ],
      },
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-10-16", prices: { hp: 0.4, hc: 0.1 } }],
    });
    const body = (
      await app.inject({ method: "GET", url: "/api/v1/energy/history?period=year&date=2026-06-01" })
    ).json();
    expect(body.totals.cost_total).toBeCloseTo(10 * 0.2 + 0.2 + 0.4, 4);
  });

  it("states the prices in force on the last day of a Bilan period", async () => {
    app = await buildApp({
      equipments: main,
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-05-15", prices: { hp: 0.3, hc: 0.1 } }],
    });
    const april = (
      await app.inject({ method: "GET", url: "/api/v1/energy/bilan?period=month&date=2026-04-10" })
    ).json();
    const may = (
      await app.inject({ method: "GET", url: "/api/v1/energy/bilan?period=month&date=2026-05-10" })
    ).json();
    expect(april.prices).toEqual({ hp: 0.2, hc: 0.1 });
    expect(may.prices).toEqual({ hp: 0.3, hc: 0.1 });
    expect(may.tariffConfigured).toBe(true);
  });

  it("prices the arbiter gain booked in Wh with the version of its day", async () => {
    app = await buildApp({
      equipments: main,
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-05-15", prices: { hp: 0.3, hc: 0.1 } }],
      settings: { "energy.arbiter.enabled": "true" },
      arbiterGain: {
        rows: [
          // Booked in euros before spec 202: kept as booked.
          { day: "2026-05-10", equipmentId: "car", solarWh: 1000, avoidedEur: 0.5 },
          // Booked in Wh: 1 kWh HP on each side of the change.
          { day: "2026-05-14", equipmentId: "car", solarWh: 1000, solarHpWh: 1000, avoidedEur: 0 },
          { day: "2026-05-15", equipmentId: "car", solarWh: 1000, solarHpWh: 1000, avoidedEur: 0 },
        ],
        since: "2026-05-01",
      },
    });
    const body = (
      await app.inject({ method: "GET", url: "/api/v1/energy/bilan?period=month&date=2026-05-10" })
    ).json();
    expect(body.arbiter.solarWh).toBe(3000);
    expect(body.arbiter.avoided).toBeCloseTo(0.5 + 0.2 + 0.3, 4);
  });

  it("says the tariff is configured from the version in force today", async () => {
    app = await buildApp({ tariff: { schedules: [], prices: { hp: 0, hc: 0 } } });
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/energy/status" })).json(),
    ).toMatchObject({ tariffConfigured: false });
    await app.close();
    app = await buildApp({ tariff: TARIFF_20_10 });
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/energy/status" })).json(),
    ).toMatchObject({ tariffConfigured: true });
  });
});

describe("Spec 202 — tariff versions and contract routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  const VERSIONS = "/api/v1/settings/energy/tariff/versions";
  const CONTRACT = "/api/v1/settings/energy/contract";
  const LEGACY = "/api/v1/settings/energy/tariff";

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  const list = async () => (await app!.inject({ method: "GET", url: VERSIONS })).json();
  const post = (payload: Record<string, unknown>) =>
    app!.inject({ method: "POST", url: VERSIONS, payload });

  it("lists the version created from the legacy setting, oldest first", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-08-01", prices: { hp: 0.2142, hc: 0.1589 }, kva: 6 }],
    });
    const versions = await list();
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      startDate: null,
      prices: { hp: 0.2, hc: 0.1 },
      origin: "migration",
    });
    expect(versions[1]).toMatchObject({ startDate: "2026-08-01", kva: 6, origin: "manual" });
  });

  it("refuses the list to a standard user", async () => {
    app = await buildApp({ tariff: TARIFF_20_10, authRole: "standard" });
    expect((await app.inject({ method: "GET", url: VERSIONS })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: CONTRACT })).statusCode).toBe(403);
  });

  it("creates the first version without a date, then dated ones", async () => {
    app = await buildApp({});
    const first = await post({ startDate: "2026-02-01", prices: { hp: 0.2065, hc: 0.1578 } });
    expect(first.statusCode).toBe(201);
    expect(first.json().startDate).toBeNull();

    const second = await post({
      startDate: "2026-08-01",
      prices: { hp: 0.2142, hc: 0.1589 },
      fixedFeeYear: 190.81,
      kva: 6,
    });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ startDate: "2026-08-01", fixedFeeYear: 190.81, kva: 6 });
  });

  it.each([
    ["a date that does not exist", { startDate: "2026-02-30", prices: { hp: 0.2, hc: 0.1 } }],
    ["a date in another format", { startDate: "01/08/2026", prices: { hp: 0.2, hc: 0.1 } }],
    ["a negative price", { startDate: "2026-08-01", prices: { hp: -0.1, hc: 0.1 } }],
    ["a price above 5 € per kWh", { startDate: "2026-08-01", prices: { hp: 21.42, hc: 0.1 } }],
    ["a negative fee", { startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 }, fixedFeeYear: -1 }],
    ["a power of 0", { startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 }, kva: 0 }],
    ["prices missing", { startDate: "2026-08-01" }],
  ])("400s %s", async (_label, payload) => {
    app = await buildApp({ tariff: TARIFF_20_10 });
    expect((await post(payload)).statusCode).toBe(400);
    expect(await list()).toHaveLength(1);
  });

  it("409s a start date already used, on create and on edit", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      versions: [
        { startDate: "2026-02-01", prices: { hp: 0.2, hc: 0.1 } },
        { startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 } },
      ],
    });
    expect((await post({ startDate: "2026-08-01", prices: { hp: 0.3, hc: 0.1 } })).statusCode).toBe(
      409,
    );
    const [, february] = await list();
    const edit = await app.inject({
      method: "PUT",
      url: `${VERSIONS}/${february.id}`,
      payload: { startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 } },
    });
    expect(edit.statusCode).toBe(409);
  });

  it("edits a version, and keeps the first one without a date", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 } }],
    });
    const [first, august] = await list();
    const moved = await app.inject({
      method: "PUT",
      url: `${VERSIONS}/${august.id}`,
      payload: { startDate: "2026-08-02", prices: { hp: 0.25, hc: 0.12 }, fixedFeeYear: 190 },
    });
    expect(moved.json()).toMatchObject({
      startDate: "2026-08-02",
      prices: { hp: 0.25, hc: 0.12 },
      fixedFeeYear: 190,
    });
    const undated = await app.inject({
      method: "PUT",
      url: `${VERSIONS}/${first.id}`,
      payload: { startDate: "2020-01-01", prices: { hp: 0.18, hc: 0.09 } },
    });
    expect(undated.json()).toMatchObject({ startDate: null, prices: { hp: 0.18, hc: 0.09 } });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `${VERSIONS}/unknown`,
          payload: { prices: { hp: 0.2, hc: 0.1 } },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("deletes a dated version, never the first one", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 } }],
    });
    const [first, august] = await list();
    expect(
      (await app.inject({ method: "DELETE", url: `${VERSIONS}/${first.id}` })).statusCode,
    ).toBe(409);
    const removed = await app.inject({ method: "DELETE", url: `${VERSIONS}/${august.id}` });
    expect(removed.json()).toEqual({ ok: true });
    expect(await list()).toHaveLength(1);
    expect(
      (await app.inject({ method: "DELETE", url: `${VERSIONS}/${august.id}` })).statusCode,
    ).toBe(404);
  });

  it("serves the prices of the version in force today on the legacy GET", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      versions: [
        { startDate: "2020-01-01", prices: { hp: 0.3, hc: 0.15 } },
        { startDate: "2999-01-01", prices: { hp: 9 / 2, hc: 1 } },
      ],
    });
    const body = (await app.inject({ method: "GET", url: LEGACY })).json();
    expect(body.prices).toEqual({ hp: 0.3, hc: 0.15 });
    expect(body.schedules).toEqual(TARIFF_20_10.schedules);
  });

  it("saves the schedule alone on the legacy PUT, leaving the versions as they are", async () => {
    app = await buildApp({ tariff: TARIFF_20_10 });
    const schedules = [{ days: [1], slots: [{ start: "22:00", end: "06:00", tariff: "hc" }] }];
    const res = await app.inject({ method: "PUT", url: LEGACY, payload: { schedules } });
    expect(res.statusCode).toBe(200);
    const writes = (app as unknown as { settingsWrites: Array<[string, string]> }).settingsWrites;
    expect(JSON.parse(writes[0][1])).toEqual({ schedules, prices: TARIFF_20_10.prices });
    expect(await list()).toMatchObject([{ startDate: null, prices: { hp: 0.2, hc: 0.1 } }]);
  });

  it("edits today's version in place when the legacy PUT carries prices", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2020-01-01", prices: { hp: 0.25, hc: 0.12 }, kva: 6 }],
    });
    const res = await app.inject({
      method: "PUT",
      url: LEGACY,
      payload: { schedules: [], prices: { hp: 0.27, hc: 0.2 } },
    });
    expect(res.statusCode).toBe(200);
    const versions = await list();
    expect(versions).toHaveLength(2);
    expect(versions[0].prices).toEqual({ hp: 0.2, hc: 0.1 }); // the past is untouched
    expect(versions[1]).toMatchObject({
      startDate: "2020-01-01",
      prices: { hp: 0.27, hc: 0.2 },
      kva: 6,
    });
  });

  it("creates the first version from a legacy PUT with prices, and none from 0/0", async () => {
    app = await buildApp({});
    await app.inject({
      method: "PUT",
      url: LEGACY,
      payload: { schedules: [], prices: { hp: 0, hc: 0 } },
    });
    expect(await list()).toEqual([]);
    await app.inject({
      method: "PUT",
      url: LEGACY,
      payload: { schedules: [], prices: { hp: 0.27, hc: 0.2 } },
    });
    expect(await list()).toMatchObject([{ startDate: null, prices: { hp: 0.27, hc: 0.2 } }]);
  });

  it("400s a legacy PUT whose price is out of range, and writes nothing", async () => {
    app = await buildApp({ tariff: TARIFF_20_10 });
    const res = await app.inject({
      method: "PUT",
      url: LEGACY,
      payload: { schedules: [], prices: { hp: 27, hc: 0.2 } },
    });
    expect(res.statusCode).toBe(400);
    const writes = (app as unknown as { settingsWrites: Array<[string, string]> }).settingsWrites;
    expect(writes).toEqual([]);
  });

  it("400s a legacy PUT with a negative price even when no version exists", async () => {
    app = await buildApp({});
    const res = await app.inject({
      method: "PUT",
      url: LEGACY,
      payload: { schedules: [], prices: { hp: -1, hc: 0 } },
    });
    expect(res.statusCode).toBe(400);
    const writes = (app as unknown as { settingsWrites: Array<[string, string]> }).settingsWrites;
    expect(writes).toEqual([]);
  });

  it("keeps the fee and the power of a version edited without them", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      versions: [
        { startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 }, fixedFeeYear: 190.81, kva: 6 },
      ],
    });
    const [, august] = await list();
    const kept = await app.inject({
      method: "PUT",
      url: `${VERSIONS}/${august.id}`,
      payload: { prices: { hp: 0.2142, hc: 0.1589 } },
    });
    expect(kept.json()).toMatchObject({ startDate: "2026-08-01", fixedFeeYear: 190.81, kva: 6 });
    const cleared = await app.inject({
      method: "PUT",
      url: `${VERSIONS}/${august.id}`,
      payload: { prices: { hp: 0.2142, hc: 0.1589 }, fixedFeeYear: null },
    });
    expect(cleared.json()).toMatchObject({ fixedFeeYear: null, kva: 6 });
  });

  it("derives the contract before one is saved", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      versions: [{ startDate: "2026-08-01", prices: { hp: 0.2, hc: 0.1 }, kva: 9 }],
    });
    expect((await app.inject({ method: "GET", url: CONTRACT })).json()).toEqual({
      supplier: "other",
      contractType: TARIFF_20_10.schedules.some((s) => s.slots.some((x) => x.tariff === "hc"))
        ? "hphc"
        : "base",
      kva: 9,
      autoUpdate: false,
    });
    await app.close();
    app = await buildApp({});
    expect((await app.inject({ method: "GET", url: CONTRACT })).json()).toEqual({
      supplier: "other",
      contractType: "base",
      kva: null,
      autoUpdate: false,
    });
  });

  it("falls back on the default when the stored contract is not a known one", async () => {
    app = await buildApp({
      settings: {
        "energy.contract": JSON.stringify({ supplier: "<b>x</b>", contractType: "hphc", kva: 6 }),
      },
    });
    expect((await app.inject({ method: "GET", url: CONTRACT })).json()).toEqual({
      supplier: "other",
      contractType: "base",
      kva: null,
      autoUpdate: false,
    });
  });

  it("saves the contract and reads it back", async () => {
    app = await buildApp({ tariff: TARIFF_20_10 });
    const contract = { supplier: "edf-tarif-bleu", contractType: "hphc", kva: 6 };
    const res = await app.inject({ method: "PUT", url: CONTRACT, payload: contract });
    expect(res.statusCode).toBe(200);
    // Spec 203 — a supplier of the price file follows it unless switched off.
    expect(res.json()).toEqual({ ...contract, autoUpdate: true });
    expect((await app.inject({ method: "GET", url: CONTRACT })).json()).toEqual({
      ...contract,
      autoUpdate: true,
    });
    const off = await app.inject({
      method: "PUT",
      url: CONTRACT,
      payload: { ...contract, autoUpdate: false },
    });
    expect(off.json()).toEqual({ ...contract, autoUpdate: false });
  });

  it.each([
    ["an unknown supplier", { supplier: "engie", contractType: "hphc", kva: 6 }],
    ["an unknown contract type", { supplier: "other", contractType: "tempo", kva: 6 }],
    ["a power of 0", { supplier: "other", contractType: "hphc", kva: 0 }],
    ["a missing power", { supplier: "other", contractType: "hphc" }],
  ])("400s a contract with %s", async (_label, payload) => {
    app = await buildApp({});
    expect((await app.inject({ method: "PUT", url: CONTRACT, payload })).statusCode).toBe(400);
  });
});

describe("Spec 203 — price file routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  const STATUS = "/api/v1/settings/energy/price-file";
  const VERSIONS = "/api/v1/settings/energy/tariff/versions";
  const CONTRACT = "/api/v1/settings/energy/contract";

  const fileRow = (startDate: string, hp: number, hc: number, fixedFeeYear: number) => ({
    contractType: "hphc",
    kva: 9,
    startDate,
    hp,
    hc,
    fixedFeeYear,
  });
  const FILE = {
    format: 1,
    generatedAt: "2026-11-11",
    suppliers: [
      {
        id: "edf-tarif-bleu",
        name: "EDF, Tarif Bleu (tarif réglementé)",
        source: "CRE",
        sourceUrl: "https://www.cre.fr/documents/open-data",
        prices: [
          fileRow("2026-02-01", 0.2065, 0.1578, 235.92),
          fileRow("2026-08-01", 0.2142, 0.1589, 239.84),
        ],
      },
    ],
  };
  const EDF_9 = JSON.stringify({ supplier: "edf-tarif-bleu", contractType: "hphc", kva: 9 });

  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  const post = (path: string, payload?: Record<string, unknown>) =>
    app!.inject({ method: "POST", url: `${STATUS}${path}`, ...(payload ? { payload } : {}) });
  const versions = async () => (await app!.inject({ method: "GET", url: VERSIONS })).json();

  it("refuses the status to a standard user", async () => {
    app = await buildApp({ tariff: TARIFF_20_10, priceFile: FILE, authRole: "standard" });
    expect((await app.inject({ method: "GET", url: STATUS })).statusCode).toBe(403);
  });

  it("answers an empty status when no contract follows the file", async () => {
    app = await buildApp({ tariff: TARIFF_20_10, priceFile: FILE });
    const status = (await post("/check")).json();
    expect(status).toMatchObject({ following: false, pending: [], lastCheckAt: null });
  });

  it("reads the file on demand and holds the past prices", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      priceFile: FILE,
      settings: { "energy.contract": EDF_9 },
    });
    const status = (await post("/check")).json();
    expect(status.following).toBe(true);
    expect(status.pending.map((r: { startDate: string }) => r.startDate)).toEqual([
      "2026-08-01",
      "2026-02-01",
    ]);
    expect((await app.inject({ method: "GET", url: STATUS })).json().pending).toHaveLength(2);
    expect(await versions()).toHaveLength(1);
  });

  it("adds the held prices, and refuses a date that is not waiting", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      priceFile: FILE,
      settings: { "energy.contract": EDF_9 },
    });
    await post("/check");

    const refused = await post("/apply", { startDates: ["2026-08-01", "2020-01-01"] });
    expect(refused.statusCode).toBe(400);
    expect(await versions()).toHaveLength(1);

    const applied = (await post("/apply", { startDates: ["2026-02-01", "2026-08-01"] })).json();
    expect(applied.created).toHaveLength(2);
    expect(applied.status.pending).toEqual([]);
    expect(await versions()).toMatchObject([
      { startDate: null, origin: "migration" },
      { startDate: "2026-02-01", origin: "file:edf-tarif-bleu", kva: 9, fixedFeeYear: 235.92 },
      {
        startDate: "2026-08-01",
        origin: "file:edf-tarif-bleu",
        prices: { hp: 0.2142, hc: 0.1589 },
      },
    ]);
  });

  it("400s an apply or a dismiss without dates", async () => {
    app = await buildApp({ tariff: TARIFF_20_10, priceFile: FILE });
    expect((await post("/apply", { startDates: [] })).statusCode).toBe(400);
    expect((await post("/dismiss", {})).statusCode).toBe(400);
  });

  it("400s a dismiss of something that is not a day", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      priceFile: FILE,
      settings: { "energy.contract": EDF_9 },
    });
    await post("/check");
    expect((await post("/dismiss", { startDates: ["x|y"] })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: STATUS })).json().dismissedCount).toBe(0);
  });

  it("sets prices aside, and proposes them again on request", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      priceFile: FILE,
      settings: { "energy.contract": EDF_9 },
    });
    await post("/check");
    const dismissed = (await post("/dismiss", { startDates: ["2026-02-01", "2026-08-01"] })).json();
    expect(dismissed).toMatchObject({ pending: [], dismissedCount: 2 });
    expect((await post("/check")).json().pending).toEqual([]);
    expect((await post("/restore-dismissed")).json().pending).toHaveLength(2);
  });

  it("reads the file when the contract is saved", async () => {
    app = await buildApp({ tariff: TARIFF_20_10, priceFile: FILE });
    const fetches = (app as unknown as { priceFileFetches: () => number }).priceFileFetches;
    await app.inject({
      method: "PUT",
      url: CONTRACT,
      payload: { supplier: "edf-tarif-bleu", contractType: "hphc", kva: 9 },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetches()).toBe(1);
    expect((await app.inject({ method: "GET", url: STATUS })).json().pending).toHaveLength(2);
  });

  it("sets a deleted file version aside, so the next read does not add it again", async () => {
    app = await buildApp({
      tariff: TARIFF_20_10,
      priceFile: FILE,
      settings: { "energy.contract": EDF_9 },
    });
    await post("/check");
    await post("/apply", { startDates: ["2026-02-01", "2026-08-01"] });
    const august = (await versions()).find(
      (v: { startDate: string | null }) => v.startDate === "2026-08-01",
    );
    await app.inject({ method: "DELETE", url: `${VERSIONS}/${august.id}` });

    const status = (await post("/check")).json();
    expect(await versions()).toHaveLength(2);
    expect(status).toMatchObject({ pending: [], dismissedCount: 1 });
  });
});
