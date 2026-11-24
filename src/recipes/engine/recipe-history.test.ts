import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecipeHistory } from "./recipe-history.js";
import { createLogger } from "../../core/logger.js";
import type { InfluxClient } from "../../core/influx-client.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { Logger } from "../../core/logger.js";

/**
 * Spec 211 FR2 — the recipe history wrapper. The fake Influx answers per
 * bucket, with the stamps `queryHistory` really produces today (FR2.9), so
 * these cases pin the normalisation on (category, source).
 */

const NOW = "2026-11-17T15:42:39Z";
const TZ = "Europe/Paris";

type Row = Record<string, unknown>;

interface FakeBinding {
  alias: string;
  type: string;
  category: string;
}

function makeEquipmentManager(
  bindings: Record<string, FakeBinding[]>,
  computed: Record<string, { alias: string; category?: string }[]> = {},
): EquipmentManager {
  return {
    getDataBindingsWithValues: (id: string) => bindings[id] ?? [],
    getComputedDataFor: (id: string) => computed[id] ?? [],
  } as unknown as EquipmentManager;
}

function makeInflux(opts: {
  rowsFor?: (flux: string) => Row[];
  connected?: boolean;
  capture?: string[];
  failMidway?: boolean;
}): InfluxClient {
  const queryApi = {
    iterateRows(flux: string) {
      opts.capture?.push(flux);
      // Like Influx: only the rows inside the query's range [start, stop).
      const m = flux.match(/range\(start: ([^,]+), stop: ([^)]+)\)/);
      const inRange = (r: Row) =>
        !m ||
        (Date.parse(String(r._time)) >= Date.parse(m[1]) &&
          Date.parse(String(r._time)) < Date.parse(m[2]));
      const rows = (opts.rowsFor?.(flux) ?? []).filter(inRange);
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

const isRaw = (flux: string) => flux.includes('from(bucket: "sowel")');
const isDownsampled = (flux: string) => !isRaw(flux);

/** Rows every hour from `fromIso` (inclusive) to `toIso` (inclusive). */
function hourly(fromIso: string, toIso: string, make: (iso: string) => Row): Row[] {
  const out: Row[] = [];
  for (let t = Date.parse(fromIso); t <= Date.parse(toIso); t += 3_600_000) {
    out.push(make(new Date(t).toISOString()));
  }
  return out;
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

const EM = makeEquipmentManager(
  {
    meter: [{ alias: "energy", type: "number", category: "energy" }],
    gauge: [{ alias: "rain", type: "number", category: "rain" }],
    thermo: [
      { alias: "temperature", type: "number", category: "temperature" },
      { alias: "open", type: "boolean", category: "generic" },
      { alias: "mode", type: "enum", category: "generic" },
    ],
  },
  { submeter: [{ alias: "energy", category: "energy" }] },
);

function helper(influx: InfluxClient, logger: Logger = silent, em: EquipmentManager = EM) {
  return createRecipeHistory({
    influxClient: influx,
    equipmentManager: em,
    logger,
    instanceId: "inst-1",
    timezone: TZ,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("recipe history — stamps (FR2.5, FR2.6)", () => {
  it("energy 1h, raw fallback stamped at the end + a partial last row → hour starts, complete hours only", async () => {
    const capture: string[] = [];
    // What the raw fallback returns for [12:00, 17:00): hours stamped at their
    // end, the running hour's partial bucket stamped at the stop (17:00 here).
    const influx = makeInflux({
      capture,
      rowsFor: (flux) =>
        isDownsampled(flux)
          ? []
          : [
              { _time: "2026-11-17T13:00:00Z", _value: 300 },
              { _time: "2026-11-17T14:00:00Z", _value: 310 },
              { _time: "2026-11-17T15:00:00Z", _value: 320 },
              { _time: "2026-11-17T16:00:00Z", _value: 120 }, // running 15:00-15:42
            ],
    });
    const res = await helper(influx).query({
      equipmentId: "meter",
      alias: "energy",
      from: "2026-11-17T12:00:00Z",
      aggregation: "1h",
    });
    expect(res.ok).toBe(true);
    expect(res.points.map((p) => [p.time, p.value])).toEqual([
      ["2026-11-17T12:00:00.000Z", 300],
      ["2026-11-17T13:00:00.000Z", 310],
      ["2026-11-17T14:00:00.000Z", 320],
    ]);
    // FR2.5.4 — the query runs to the aligned `to` (15:00) + 1 h.
    // FR2.5.4 / FR2.5.6 — the head runs to the last complete hour (14:00) + 1 h;
    // that hour is read from the raw bucket, to 15:00 + 1 h.
    expect(capture[0]).toContain(
      "range(start: 2026-11-17T12:00:00.000Z, stop: 2026-11-17T15:00:00.000Z)",
    );
    expect(capture.at(-1)).toContain('from(bucket: "sowel")');
    expect(capture.at(-1)).toContain(
      "range(start: 2026-11-17T14:00:00.000Z, stop: 2026-11-17T16:00:00.000Z)",
    );
  });

  it("energy 1h, `source: downsampled` rows stamped at the start → stamps unchanged, the last hour from raw (end-stamped)", async () => {
    const influx = makeInflux({
      rowsFor: (flux) =>
        isDownsampled(flux)
          ? [
              { _time: "2026-11-17T12:00:00Z", _value: 300 },
              { _time: "2026-11-17T15:00:00Z", _value: 99 }, // running hour
            ]
          : [{ _time: "2026-11-17T15:00:00Z", _value: 320 }], // raw: hour 14:00 at its end
    });
    const res = await helper(influx).query({
      equipmentId: "meter",
      alias: "energy",
      from: "2026-11-17T12:00:00Z",
      aggregation: "1h",
    });
    expect(res.points.map((p) => p.time)).toEqual([
      "2026-11-17T12:00:00.000Z",
      "2026-11-17T14:00:00.000Z",
    ]);
  });

  it("rain 1h, rows stamped at the start → unchanged, the running hour absent, the last complete hour present", async () => {
    const influx = makeInflux({
      rowsFor: () => [
        { _time: "2026-11-17T12:00:00Z", _value: 0.2 },
        { _time: "2026-11-17T14:00:00Z", _value: 0.4 },
        { _time: "2026-11-17T15:00:00Z", _value: 0.1 }, // running hour
      ],
    });
    const res = await helper(influx).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-11-17T12:00:00Z",
      aggregation: "1h",
    });
    expect(res.points.map((p) => [p.time, p.value])).toEqual([
      ["2026-11-17T12:00:00.000Z", 0.2],
      ["2026-11-17T14:00:00.000Z", 0.4],
    ]);
  });

  it("energy and rain over -24h give the same complete hours, the last one included (acceptance)", async () => {
    const energy = makeInflux({
      rowsFor: (flux) =>
        isDownsampled(flux)
          ? []
          : hourly("2026-11-16T16:00:00Z", "2026-11-17T16:00:00Z", (t) => ({
              _time: t,
              _value: 1,
            })),
    });
    const rain = makeInflux({
      rowsFor: () =>
        hourly("2026-11-16T15:00:00Z", "2026-11-17T15:00:00Z", (t) => ({ _time: t, _value: 1 })),
    });
    const q = { from: "-24h", aggregation: "1h" as const };
    const e = await helper(energy).query({ equipmentId: "meter", alias: "energy", ...q });
    const r = await helper(rain).query({ equipmentId: "gauge", alias: "rain", ...q });
    expect(e.points.map((p) => p.time)).toEqual(r.points.map((p) => p.time));
    expect(e.points).toHaveLength(23); // 16:00 yesterday (rounded up) → 14:00 today
    expect(e.points[0].time).toBe("2026-11-16T16:00:00.000Z");
    expect(e.points.at(-1)?.time).toBe("2026-11-17T14:00:00.000Z");
  });

  it("temperature 1h, rows stamped at the end → hour starts, min/max kept", async () => {
    const influx = makeInflux({
      rowsFor: () => [
        { _time: "2026-11-17T13:00:00Z", mean: 18, min: 17, max: 19 },
        { _time: "2026-11-17T15:00:00Z", mean: 20, min: 19.5, max: 20.5 },
      ],
    });
    const res = await helper(influx).query({
      equipmentId: "thermo",
      alias: "temperature",
      from: "2026-11-17T12:00:00Z",
      aggregation: "1h",
    });
    expect(res.points).toEqual([
      { time: "2026-11-17T12:00:00.000Z", value: 18, min: 17, max: 19 },
      { time: "2026-11-17T14:00:00.000Z", value: 20, min: 19.5, max: 20.5 },
    ]);
  });

  it("temperature 1d → labelled by UTC date, one day back (FR2.6 exception)", async () => {
    const influx = makeInflux({
      rowsFor: () => [
        { _time: "2026-11-15T00:00:00Z", mean: 10 },
        { _time: "2026-11-16T00:00:00Z", mean: 11 },
        { _time: "2026-11-17T00:00:00Z", mean: 12 },
      ],
    });
    const res = await helper(influx).query({
      equipmentId: "thermo",
      alias: "temperature",
      from: "2026-11-14T00:00:00Z",
      aggregation: "1d",
    });
    expect(res.points.map((p) => [p.time, p.value])).toEqual([
      ["2026-11-14T00:00:00.000Z", 10],
      ["2026-11-15T00:00:00.000Z", 11],
      ["2026-11-16T00:00:00.000Z", 12],
    ]);
  });

  it("energy 1d with a partial running day → UTC days at their start, running day absent", async () => {
    const influx = makeInflux({
      rowsFor: (flux) =>
        isDownsampled(flux)
          ? []
          : [
              { _time: "2026-11-15T00:00:00Z", _value: 9 },
              { _time: "2026-11-16T00:00:00Z", _value: 10 },
              { _time: "2026-11-17T00:00:00Z", _value: 11 },
              { _time: "2026-11-18T00:00:00Z", _value: 4 }, // running day
            ],
    });
    const res = await helper(influx).query({
      equipmentId: "meter",
      alias: "energy",
      from: "2026-11-14T00:00:00Z",
      aggregation: "1d",
    });
    expect(res.points.map((p) => p.time)).toEqual([
      "2026-11-14T00:00:00.000Z",
      "2026-11-15T00:00:00.000Z",
      "2026-11-16T00:00:00.000Z",
    ]);
  });

  it("rain 1d → local days, stamped at local midnight, the running day absent", async () => {
    const capture: string[] = [];
    const influx = makeInflux({
      capture,
      rowsFor: () => [
        { _time: "2026-11-14T23:00:00Z", _value: 2 }, // 15 Nov 00:00 Paris
        { _time: "2026-11-15T23:00:00Z", _value: 3 }, // 16 Nov
        { _time: "2026-11-16T23:00:00Z", _value: 1 }, // 17 Nov — running
      ],
    });
    const res = await helper(influx).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-11-14T12:00:00Z",
      aggregation: "1d",
    });
    expect(res.points.map((p) => p.time)).toEqual([
      "2026-11-14T23:00:00.000Z",
      "2026-11-15T23:00:00.000Z",
    ]);
    // from rounded up to the next local midnight, to + 1 local day.
    expect(capture[0]).toContain(
      "range(start: 2026-11-14T23:00:00.000Z, stop: 2026-11-16T23:00:00.000Z)",
    );
    // The last complete day (16 Nov) from raw, to + 1 local day.
    expect(capture.at(-1)).toContain(
      "range(start: 2026-11-15T23:00:00.000Z, stop: 2026-11-17T23:00:00.000Z)",
    );
  });

  it("rain 1d across the DST change keeps whole local days (25 h)", async () => {
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    const capture: string[] = [];
    const influx = makeInflux({
      capture,
      rowsFor: () => [
        { _time: "2026-10-24T22:00:00Z", _value: 1 }, // 25 Oct, CEST midnight
        { _time: "2026-10-25T23:00:00Z", _value: 2 }, // 26 Oct, CET midnight
      ],
    });
    const res = await helper(influx).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-10-24T12:00:00Z",
      aggregation: "1d",
    });
    expect(res.points.map((p) => p.time)).toEqual([
      "2026-10-24T22:00:00.000Z",
      "2026-10-25T23:00:00.000Z",
    ]);
    expect(capture[0]).toContain(
      "range(start: 2026-10-24T22:00:00.000Z, stop: 2026-10-26T23:00:00.000Z)",
    );
    // 26 Oct, after the 25-hour day, from raw.
    expect(capture.at(-1)).toContain(
      "range(start: 2026-10-25T23:00:00.000Z, stop: 2026-10-27T23:00:00.000Z)",
    );
  });

  it("a `to` one hour in the future is treated as now: the running hour is absent", async () => {
    const capture: string[] = [];
    const influx = makeInflux({
      capture,
      rowsFor: () => [
        { _time: "2026-11-17T14:00:00Z", _value: 0.4 },
        { _time: "2026-11-17T15:00:00Z", _value: 0.1 },
      ],
    });
    const res = await helper(influx).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-11-17T14:00:00Z",
      to: "2026-11-17T16:42:39Z",
      aggregation: "1h",
    });
    expect(res.points.map((p) => p.time)).toEqual(["2026-11-17T14:00:00.000Z"]);
    expect(capture[0]).toContain("stop: 2026-11-17T16:00:00.000Z");
  });

  it("a relative `to` is read like `from`", async () => {
    const capture: string[] = [];
    const influx = makeInflux({ capture });
    await helper(influx).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "-6h",
      to: "-2h",
      aggregation: "1h",
    });
    // from 09:42:39 → 10:00; to 13:42:39 → 13:00; stop 14:00.
    expect(capture[0]).toContain(
      "range(start: 2026-11-17T10:00:00.000Z, stop: 2026-11-17T13:00:00.000Z)",
    );
    expect(capture.at(-1)).toContain(
      "range(start: 2026-11-17T12:00:00.000Z, stop: 2026-11-17T14:00:00.000Z)",
    );
  });

  it("`from` = -7d at 15:42 is rounded up to the next hour", async () => {
    const capture: string[] = [];
    await helper(makeInflux({ capture })).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "-7d",
      aggregation: "1h",
    });
    expect(capture[0]).toContain("range(start: 2026-11-10T16:00:00.000Z,");
  });

  it("an hour without rows has no point (nothing zero-filled)", async () => {
    const influx = makeInflux({
      rowsFor: () => [
        { _time: "2026-11-17T11:00:00Z", _value: 0.2 },
        { _time: "2026-11-17T14:00:00Z", _value: 0.4 },
      ],
    });
    const res = await helper(influx).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-11-17T10:00:00Z",
      aggregation: "1h",
    });
    expect(res.points).toHaveLength(2);
  });

  it("an alias that is a computed data entry with category energy is queried as energy", async () => {
    const capture: string[] = [];
    const influx = makeInflux({
      capture,
      rowsFor: (flux) =>
        isDownsampled(flux) ? [] : [{ _time: "2026-11-17T15:00:00Z", _value: 7 }],
    });
    const res = await helper(influx).query({
      equipmentId: "submeter",
      alias: "energy",
      from: "2026-11-17T12:00:00Z",
      aggregation: "1h",
    });
    expect(capture[0]).toContain('from(bucket: "sowel-energy-hourly")');
    expect(res.points.map((p) => p.time)).toEqual(["2026-11-17T14:00:00.000Z"]);
  });
});

describe("recipe history — answered without Influx (FR2.3-FR2.5)", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["unknown alias", { equipmentId: "thermo", alias: "nope", from: "-24h", aggregation: "1h" }],
    [
      "unknown equipment",
      { equipmentId: "ghost", alias: "temperature", from: "-24h", aggregation: "1h" },
    ],
    ["boolean binding", { equipmentId: "thermo", alias: "open", from: "-24h", aggregation: "1h" }],
    ["enum binding", { equipmentId: "thermo", alias: "mode", from: "-24h", aggregation: "1h" }],
    [
      "aggregation raw",
      { equipmentId: "thermo", alias: "temperature", from: "-24h", aggregation: "raw" },
    ],
    [
      "aggregation 5m",
      { equipmentId: "thermo", alias: "temperature", from: "-24h", aggregation: "5m" },
    ],
    [
      "unparsable from",
      { equipmentId: "thermo", alias: "temperature", from: "yesterday", aggregation: "1h" },
    ],
    [
      "unparsable to",
      { equipmentId: "thermo", alias: "temperature", from: "-24h", to: "later", aggregation: "1h" },
    ],
    [
      "aligned to not after aligned from",
      { equipmentId: "thermo", alias: "temperature", from: "-30m", aggregation: "1h" },
    ],
    [
      "to before from",
      { equipmentId: "thermo", alias: "temperature", from: "-2h", to: "-5h", aggregation: "1h" },
    ],
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

describe("recipe history — errors (FR2.8)", () => {
  it("Influx not configured → { points: [], ok: false }, no query", async () => {
    const capture: string[] = [];
    const res = await helper(makeInflux({ capture, connected: false })).query({
      equipmentId: "thermo",
      alias: "temperature",
      from: "-24h",
      aggregation: "1h",
    });
    expect(res).toEqual({ points: [], ok: false });
    expect(capture).toHaveLength(0);
  });

  it("a query failing after partial rows → { points: [], ok: false }", async () => {
    const res = await helper(
      makeInflux({
        failMidway: true,
        rowsFor: () => [
          { _time: "2026-11-17T13:00:00Z", mean: 18 },
          { _time: "2026-11-17T14:00:00Z", mean: 19 },
        ],
      }),
    ).query({ equipmentId: "thermo", alias: "temperature", from: "-24h", aggregation: "1h" });
    expect(res).toEqual({ points: [], ok: false });
  });

  it("a programming error inside the wrapper → { points: [], ok: false } and an error log", async () => {
    const { logger, errors } = spyLogger();
    const broken = {
      getDataBindingsWithValues: () => {
        throw new TypeError("boom");
      },
    } as unknown as EquipmentManager;
    const res = await helper(makeInflux({}), logger, broken).query({
      equipmentId: "thermo",
      alias: "temperature",
      from: "-24h",
      aggregation: "1h",
    });
    expect(res).toEqual({ points: [], ok: false });
    expect(errors).toHaveLength(1);
  });

  it("a window older than 7 days is clamped, with one warn per helper", async () => {
    const { logger, warns } = spyLogger();
    const capture: string[] = [];
    const h = helper(makeInflux({ capture }), logger);
    const q = {
      equipmentId: "thermo",
      alias: "temperature",
      from: "-30d",
      aggregation: "1h" as const,
    };
    await h.query(q);
    await h.query(q);
    expect(capture[0]).toContain("range(start: 2026-11-10T16:00:00.000Z,");
    expect(warns).toHaveLength(1);
  });
});

describe("recipe history — rate limit (FR2.7)", () => {
  const real = {
    equipmentId: "thermo",
    alias: "temperature",
    from: "-24h",
    aggregation: "1h" as const,
  };

  it("the 11th call reaching Influx within 60 s rejects", async () => {
    const h = helper(makeInflux({}));
    for (let i = 0; i < 10; i++) await h.query(real);
    await expect(h.query(real)).rejects.toThrow("history rate limit");
  });

  it("calls answered without Influx do not count", async () => {
    const h = helper(makeInflux({}));
    for (let i = 0; i < 20; i++) await h.query({ ...real, alias: "nope" });
    for (let i = 0; i < 10; i++) await expect(h.query(real)).resolves.toMatchObject({ ok: true });
  });

  it("the window rolls: 61 s later one more is accepted", async () => {
    const h = helper(makeInflux({}));
    for (let i = 0; i < 10; i++) await h.query(real);
    vi.setSystemTime(new Date(Date.parse(NOW) + 61_000));
    await expect(h.query(real)).resolves.toMatchObject({ ok: true });
  });

  it("two helpers (two instances, or a validate context) have their own budget", async () => {
    const a = helper(makeInflux({}));
    const b = helper(makeInflux({}));
    for (let i = 0; i < 10; i++) await a.query(real);
    for (let i = 0; i < 10; i++) await expect(b.query(real)).resolves.toMatchObject({ ok: true });
  });
});

describe("recipe history — review follow-ups", () => {
  it("FR2.5.6 — the last complete hour not yet downsampled is read again from the raw bucket", async () => {
    vi.setSystemTime(new Date("2026-11-17T15:00:05Z"));
    const capture: string[] = [];
    const influx = makeInflux({
      capture,
      rowsFor: (flux) => {
        // Rain, start-stamped. The hourly task has not written 14:00 yet.
        if (isDownsampled(flux)) {
          return [
            { _time: "2026-11-17T12:00:00Z", _value: 0.2 },
            { _time: "2026-11-17T13:00:00Z", _value: 0.3 },
          ];
        }
        return [{ _time: "2026-11-17T14:00:00Z", _value: 0.5 }];
      },
    });
    const res = await helper(influx).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-11-17T12:00:00Z",
      aggregation: "1h",
    });
    expect(res.ok).toBe(true);
    expect(res.points.map((p) => [p.time, p.value])).toEqual([
      ["2026-11-17T12:00:00.000Z", 0.2],
      ["2026-11-17T13:00:00.000Z", 0.3],
      ["2026-11-17T14:00:00.000Z", 0.5],
    ]);
  });

  it("FR2.5.6 — review case: the hourly bucket holds 13:00 (stamped 14:00) but not 14:00 yet; 14:00 comes from raw", async () => {
    vi.setSystemTime(new Date("2026-11-17T15:00:05Z"));
    const influx = makeInflux({
      rowsFor: (flux) => {
        if (isDownsampled(flux)) {
          return [{ _time: "2026-11-17T14:00:00Z", mean: 18 }]; // hour 13:00, end-stamped
        }
        return [{ _time: "2026-11-17T15:00:00Z", mean: 19 }]; // hour 14:00, end-stamped
      },
    });
    const res = await helper(influx).query({
      equipmentId: "thermo",
      alias: "temperature",
      from: "2026-11-17T13:00:00Z",
      aggregation: "1h",
    });
    expect(res.points.map((p) => [p.time, p.value])).toEqual([
      ["2026-11-17T13:00:00.000Z", 18],
      ["2026-11-17T14:00:00.000Z", 19],
    ]);
  });

  it("FR2.5.6 — the last complete period comes from raw even when the downsampled bucket holds a partial copy", async () => {
    const capture: string[] = [];
    const res = await helper(
      makeInflux({
        capture,
        rowsFor: (flux) =>
          isDownsampled(flux)
            ? [{ _time: "2026-11-17T14:00:00Z", _value: 0.1 }]
            : [{ _time: "2026-11-17T14:00:00Z", _value: 0.4 }],
      }),
    ).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-11-17T12:00:00Z",
      aggregation: "1h",
    });
    expect(res.points.map((p) => [p.time, p.value])).toEqual([["2026-11-17T14:00:00.000Z", 0.4]]);
    expect(capture.at(-1)).toContain('from(bucket: "sowel")');
  });

  it("FR2.5.6 — a one-period window reads the raw bucket only", async () => {
    const capture: string[] = [];
    await helper(makeInflux({ capture })).query({
      equipmentId: "thermo",
      alias: "temperature",
      from: "2026-11-17T14:00:00Z",
      aggregation: "1h",
    });
    expect(capture).toHaveLength(1);
    expect(capture[0]).toContain('from(bucket: "sowel")');
  });

  it("FR2.8 — a failing re-read → { points: [], ok: false }", async () => {
    vi.setSystemTime(new Date("2026-11-17T15:00:05Z"));
    let calls = 0;
    const influx = makeInflux({
      rowsFor: () => {
        calls++;
        if (calls === 1) return [{ _time: "2026-11-17T12:00:00Z", _value: 0.2 }];
        throw new Error("influx down");
      },
    });
    const res = await helper(influx).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-11-17T12:00:00Z",
      aggregation: "1h",
    });
    expect(res).toEqual({ points: [], ok: false });
  });

  it("FR2.7 — calls answered while Influx is not configured do not count", async () => {
    let connected = false;
    const influx = {
      ...makeInflux({}),
      isConnected: () => connected,
    } as unknown as InfluxClient;
    const h = helper(influx);
    const q = {
      equipmentId: "thermo",
      alias: "temperature",
      from: "-24h",
      aggregation: "1h" as const,
    };
    for (let i = 0; i < 20; i++)
      await expect(h.query(q)).resolves.toEqual({ points: [], ok: false });
    connected = true;
    for (let i = 0; i < 10; i++) await expect(h.query(q)).resolves.toMatchObject({ ok: true });
  });

  it("FR2.5 — rain 1d across the spring DST change keeps whole local days (23 h)", async () => {
    vi.setSystemTime(new Date("2026-03-31T10:00:00Z"));
    const capture: string[] = [];
    const influx = makeInflux({
      capture,
      rowsFor: () => [
        { _time: "2026-03-28T23:00:00Z", _value: 1 }, // 29 Mar, CET midnight
        { _time: "2026-03-29T22:00:00Z", _value: 2 }, // 30 Mar, CEST midnight
      ],
    });
    const res = await helper(influx).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-03-28T12:00:00Z",
      aggregation: "1d",
    });
    expect(res.points.map((p) => p.time)).toEqual([
      "2026-03-28T23:00:00.000Z",
      "2026-03-29T22:00:00.000Z",
    ]);
    expect(capture[0]).toContain(
      "range(start: 2026-03-28T23:00:00.000Z, stop: 2026-03-30T22:00:00.000Z)",
    );
    // 30 Mar, after the 23-hour day, from raw.
    expect(capture.at(-1)).toContain(
      "range(start: 2026-03-29T22:00:00.000Z, stop: 2026-03-31T22:00:00.000Z)",
    );
  });

  it("FR2.5 — `to: null` from a plain-JS recipe reads as now", async () => {
    const capture: string[] = [];
    await helper(makeInflux({ capture })).query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-11-17T12:00:00Z",
      to: null,
      aggregation: "1h",
    } as never);
    expect(capture.at(-1)).toContain("stop: 2026-11-17T16:00:00.000Z");
  });
});

describe("recipe history — a zone whose DST change skips midnight", () => {
  it("rain 1d in America/Santiago keeps moving forward across the skipped midnight", async () => {
    // Chile springs forward on 2026-09-06 at 00:00 local: that midnight does not exist.
    vi.setSystemTime(new Date("2026-09-08T15:00:00Z"));
    const capture: string[] = [];
    const h = createRecipeHistory({
      influxClient: makeInflux({ capture }),
      equipmentManager: EM,
      logger: silent,
      instanceId: "inst-1",
      timezone: "America/Santiago",
    });
    const res = await h.query({
      equipmentId: "gauge",
      alias: "rain",
      from: "2026-09-03T12:00:00Z",
      aggregation: "1d",
    });
    expect(res.ok).toBe(true);
    for (const flux of capture) {
      const m = flux.match(/range\(start: ([^,]+), stop: ([^)]+)\)/);
      expect(m).not.toBeNull();
      expect(Date.parse(m![2])).toBeGreaterThan(Date.parse(m![1]));
    }
  });
});
