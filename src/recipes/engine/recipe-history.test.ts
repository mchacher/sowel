import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecipeHistory, RECIPE_HISTORY_RATE_LIMIT } from "./recipe-history.js";
import { createLogger } from "../../core/logger.js";
import type { InfluxClient } from "../../core/influx-client.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { Logger } from "../../core/logger.js";

/**
 * Spec 211 FR2 — the recipe history wrapper. It always reads the raw bucket;
 * the fake Influx answers with the stamps the raw-bucket Flux produces: rain
 * at the start of its (local) period, everything else at the end of its UTC
 * period.
 */

type Row = Record<string, unknown>;

const EM = {
  getDataBindingsWithValues: (id: string) =>
    ({
      meter: [{ alias: "energy", type: "number", category: "energy" }],
      gauge: [{ alias: "rain", type: "number", category: "rain" }],
      thermo: [
        { alias: "temperature", type: "number", category: "temperature" },
        { alias: "open", type: "boolean", category: "generic" },
        { alias: "mode", type: "enum", category: "generic" },
      ],
    })[id] ?? [],
  getComputedDataFor: (id: string) =>
    id === "submeter" ? [{ alias: "energy", category: "energy" }] : [],
} as unknown as EquipmentManager;

function makeInflux(
  opts: { rows?: Row[]; connected?: boolean; capture?: string[]; failMidway?: boolean } = {},
): InfluxClient {
  const queryApi = {
    iterateRows(flux: string) {
      opts.capture?.push(flux);
      const rows = opts.rows ?? [];
      return {
        async *[Symbol.asyncIterator]() {
          for (const row of rows) {
            yield { values: row, tableMeta: { toObject: (v: unknown) => v } };
            if (opts.failMidway) throw new Error("influx boom");
          }
        },
      };
    },
  };
  return {
    isConnected: () => opts.connected ?? true,
    getConfig: () => ({ org: "o", bucket: "sowel" }),
    getClient: () => ({ getQueryApi: () => queryApi }),
  } as unknown as InfluxClient;
}

const silent = createLogger("silent").logger;

function spyLogger(): { logger: Logger; warns: unknown[]; errors: unknown[] } {
  const warns: unknown[] = [];
  const errors: unknown[] = [];
  const logger = {
    child: () => logger,
    warn: (...a: unknown[]) => warns.push(a),
    error: (...a: unknown[]) => errors.push(a),
    debug: () => {},
    info: () => {},
    trace: () => {},
  } as unknown as Logger;
  return { logger, warns, errors };
}

function helper(influx: InfluxClient, logger: Logger = silent, isCurrent?: () => boolean) {
  return createRecipeHistory({
    influxClient: influx,
    equipmentManager: EM,
    logger,
    instanceId: "inst-1",
    isCurrent,
  });
}

/** The range(start, stop) of a captured Flux query. */
function rangeOf(flux: string): [string, string] {
  const m = flux.match(/range\(start: ([^,]+), stop: ([^)]+)\)/);
  if (!m) throw new Error("no range");
  return [m[1], m[2]];
}

const savedTz = process.env.TZ;
beforeEach(() => {
  process.env.TZ = "Europe/Paris";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T15:42:39Z"));
});
afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = savedTz;
});

describe("recipe history — periods and stamps (FR2.5, FR2.6)", () => {
  it("temperature 1h: one raw-bucket query on whole UTC hours, end stamps moved to the start", async () => {
    const capture: string[] = [];
    const rows = [
      { _time: "2026-11-17T14:00:00Z", mean: 19, min: 18.5, max: 19.5 },
      { _time: "2026-11-17T15:00:00Z", mean: 20, min: 19.5, max: 20.5 },
    ];
    const res = await helper(makeInflux({ rows, capture })).query({
      equipmentId: "thermo",
      alias: "temperature",
      from: "-3h",
      aggregation: "1h",
    });
    expect(capture).toHaveLength(1);
    expect(capture[0]).toContain('from(bucket: "sowel")');
    expect(rangeOf(capture[0])).toEqual(["2026-11-17T13:00:00.000Z", "2026-11-17T15:00:00.000Z"]);
    expect(res).toEqual({
      ok: true,
      points: [
        { time: "2026-11-17T13:00:00.000Z", value: 19, min: 18.5, max: 19.5 },
        { time: "2026-11-17T14:00:00.000Z", value: 20, min: 19.5, max: 20.5 },
      ],
    });
  });

  it("a row outside the aligned window is dropped", async () => {
    const rows = [{ _time: "2026-11-17T16:00:00Z", mean: 21 }];
    const res = await helper(makeInflux({ rows })).query({
      equipmentId: "thermo",
      alias: "temperature",
      from: "-3h",
      aggregation: "1h",
    });
    expect(res).toEqual({ ok: true, points: [] });
  });

  it("energy 1d: UTC days, stamped at their start, the running day absent", async () => {
    const capture: string[] = [];
    const rows = [{ _time: "2026-11-17T00:00:00Z", _value: 6000 }];
    const res = await helper(makeInflux({ rows, capture })).query({
      equipmentId: "meter",
      alias: "energy",
      from: "-2d",
      aggregation: "1d",
    });
    expect(rangeOf(capture[0])).toEqual(["2026-11-16T00:00:00.000Z", "2026-11-17T00:00:00.000Z"]);
    expect(res.points).toEqual([{ time: "2026-11-16T00:00:00.000Z", value: 6000 }]);
  });

  it("rain 1d: local days, stamps kept at local midnight", async () => {
    const capture: string[] = [];
    const rows = [
      { _time: "2026-11-14T23:00:00Z", _value: 1.2 },
      { _time: "2026-11-15T23:00:00Z", _value: 0.4 },
    ];
    const res = await helper(makeInflux({ rows, capture })).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "-3d",
      aggregation: "1d",
    });
    expect(rangeOf(capture[0])).toEqual(["2026-11-14T23:00:00.000Z", "2026-11-16T23:00:00.000Z"]);
    expect(res.points).toEqual([
      { time: "2026-11-14T23:00:00.000Z", value: 1.2 },
      { time: "2026-11-15T23:00:00.000Z", value: 0.4 },
    ]);
  });

  it("rain 1d across the autumn DST change keeps whole local days (25 h)", async () => {
    vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
    const capture: string[] = [];
    await helper(makeInflux({ capture })).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-10-24T12:00:00Z",
      aggregation: "1d",
    });
    // Oct 25 (Paris) runs from 22:00Z (CEST) to 23:00Z (CET).
    expect(rangeOf(capture[0])).toEqual(["2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"]);
  });

  it("rain 1d across the spring DST change keeps whole local days (23 h)", async () => {
    vi.setSystemTime(new Date("2026-03-30T10:00:00Z"));
    const capture: string[] = [];
    await helper(makeInflux({ capture })).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-03-28T12:00:00Z",
      aggregation: "1d",
    });
    // Mar 29 (Paris) runs from 23:00Z (CET) to 22:00Z (CEST).
    expect(rangeOf(capture[0])).toEqual(["2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"]);
  });

  it("rain 1h in a half-hour zone follows local hours", async () => {
    process.env.TZ = "Asia/Kolkata";
    const capture: string[] = [];
    await helper(makeInflux({ capture })).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "-3h",
      aggregation: "1h",
    });
    expect(rangeOf(capture[0])).toEqual(["2026-11-17T13:30:00.000Z", "2026-11-17T15:30:00.000Z"]);
  });

  it("a `to` in the future, or null, is read as now", async () => {
    for (const to of ["2026-11-17T17:00:00Z", null]) {
      const capture: string[] = [];
      await helper(makeInflux({ capture })).query({
        equipmentId: "thermo",
        alias: "temperature",
        from: "-2h",
        to: to as string,
        aggregation: "1h",
      });
      expect(rangeOf(capture[0])[1]).toBe("2026-11-17T15:00:00.000Z");
    }
  });

  it("a computed data entry with category energy is queried as energy", async () => {
    const capture: string[] = [];
    const res = await helper(makeInflux({ capture })).query({
      equipmentId: "submeter",
      alias: "energy",
      from: "-2h",
      aggregation: "1h",
    });
    expect(res.ok).toBe(true);
    expect(capture[0]).toContain("fn: sum");
  });

  it("a window older than 7 days is clamped, with one warn per helper", async () => {
    const { logger, warns } = spyLogger();
    const capture: string[] = [];
    const h = helper(makeInflux({ capture }), logger);
    await h.query({ equipmentId: "thermo", alias: "temperature", from: "-30d", aggregation: "1h" });
    await h.query({ equipmentId: "thermo", alias: "temperature", from: "-30d", aggregation: "1h" });
    expect(rangeOf(capture[0])[0]).toBe("2026-11-10T16:00:00.000Z");
    expect(warns).toHaveLength(1);
  });
});

describe("recipe history — answered without Influx (FR2.3-FR2.5)", () => {
  const t = { equipmentId: "thermo", alias: "temperature" };
  const cases: [string, Record<string, unknown>][] = [
    ["unknown alias", { ...t, alias: "nope", from: "-24h", aggregation: "1h" }],
    ["unknown equipment", { ...t, equipmentId: "x", from: "-24h", aggregation: "1h" }],
    ["boolean binding", { ...t, alias: "open", from: "-24h", aggregation: "1h" }],
    ["enum binding", { ...t, alias: "mode", from: "-24h", aggregation: "1h" }],
    ["aggregation raw", { ...t, from: "-24h", aggregation: "raw" }],
    ["unparsable from", { ...t, from: "x", aggregation: "1h" }],
    ["unparsable to", { ...t, from: "-24h", to: "x", aggregation: "1h" }],
    ["no whole period", { ...t, from: "-30m", aggregation: "1h" }],
    ["to before from", { ...t, from: "-2h", to: "-5h", aggregation: "1h" }],
  ];
  for (const [name, params] of cases) {
    it(`${name} → { points: [], ok: true }, no Influx call`, async () => {
      const capture: string[] = [];
      const res = await helper(makeInflux({ capture })).query(params as never);
      expect(res).toEqual({ points: [], ok: true });
      expect(capture).toHaveLength(0);
    });
  }
});

describe("recipe history — failures answer ok: false and never throw (FR2.7, FR2.8)", () => {
  const q = {
    equipmentId: "thermo",
    alias: "temperature",
    from: "-3h",
    aggregation: "1h",
  } as const;
  const failed = { points: [], ok: false };

  it("Influx not configured, or a stopped start → no query", async () => {
    const capture: string[] = [];
    expect(await helper(makeInflux({ capture, connected: false })).query(q)).toEqual(failed);
    expect(await helper(makeInflux({ capture }), silent, () => false).query(q)).toEqual(failed);
    expect(capture).toHaveLength(0);
  });

  it("a query failing after partial rows drops them", async () => {
    const rows = [
      { _time: "2026-11-17T14:00:00Z", mean: 19 },
      { _time: "2026-11-17T15:00:00Z", mean: 20 },
    ];
    expect(await helper(makeInflux({ rows, failMidway: true })).query(q)).toEqual(failed);
  });

  it("a programming error inside the wrapper is logged", async () => {
    const { logger, errors } = spyLogger();
    const broken = {
      ...EM,
      getDataBindingsWithValues: () => {
        throw new Error("bug");
      },
    };
    const h = createRecipeHistory({
      influxClient: makeInflux(),
      equipmentManager: broken as unknown as EquipmentManager,
      logger,
      instanceId: "inst-1",
    });
    expect(await h.query(q)).toEqual(failed);
    expect(errors).toHaveLength(1);
  });

  it("beyond the rate limit a call resolves ok: false, it never rejects", async () => {
    const capture: string[] = [];
    const h = helper(makeInflux({ capture }));
    for (let i = 0; i < RECIPE_HISTORY_RATE_LIMIT; i++) expect((await h.query(q)).ok).toBe(true);
    await expect(h.query(q)).resolves.toEqual(failed);
    expect(capture).toHaveLength(RECIPE_HISTORY_RATE_LIMIT);
  });

  it("calls answered without Influx do not count, and the window rolls", async () => {
    const h = helper(makeInflux());
    for (let i = 0; i < 20; i++) await h.query({ ...q, alias: "nope" });
    for (let i = 0; i < RECIPE_HISTORY_RATE_LIMIT; i++) await h.query(q);
    expect((await h.query(q)).ok).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect((await h.query(q)).ok).toBe(true);
  });

  it("two helpers (two instances, or a validate context) have their own budget", async () => {
    const a = helper(makeInflux());
    for (let i = 0; i < RECIPE_HISTORY_RATE_LIMIT; i++) await a.query(q);
    expect((await a.query(q)).ok).toBe(false);
    expect((await helper(makeInflux()).query(q)).ok).toBe(true);
  });
});
