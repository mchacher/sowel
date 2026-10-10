import { describe, expect, it, vi } from "vitest";
import { InfluxClient, RAIN_HOURLY_RETENTION, buildRainCopyHourlyFlux } from "./influx-client.js";
import { createLogger } from "./logger.js";

/**
 * Writer lifecycle across a disconnect.
 *
 * The failure this guards is silent in every direction: a stale writer accepts
 * points, the caller counts them as written, and nothing reaches InfluxDB. It
 * surfaces weeks later as a forecast-versus-actual comparison with no forecast
 * in it.
 */
describe("InfluxClient disconnect", () => {
  const logger = createLogger("silent").logger;

  /** Install two fake writers and pretend we are connected. */
  function primed(defaultClose: () => Promise<void>) {
    const client = new InfluxClient(logger);
    const energyClose = vi.fn().mockResolvedValue(undefined);

    const inner = client as unknown as {
      writeApi: unknown;
      energyHourlyWriteApi: unknown;
      client: unknown;
      config: unknown;
      _connected: boolean;
    };
    inner.writeApi = { close: defaultClose };
    inner.energyHourlyWriteApi = { close: energyClose };
    inner.client = {};
    inner.config = { url: "http://x", org: "o", bucket: "b", token: "t" };
    inner._connected = true;

    return { client, inner, energyClose };
  }

  it("closes both writers on a clean disconnect", async () => {
    const defaultClose = vi.fn().mockResolvedValue(undefined);
    const { client, inner, energyClose } = primed(defaultClose);

    await client.disconnect();

    expect(defaultClose).toHaveBeenCalledOnce();
    expect(energyClose).toHaveBeenCalledOnce();
    expect(inner.writeApi).toBeNull();
    expect(inner.energyHourlyWriteApi).toBeNull();
  });

  it("still closes the energy writer when the default one fails to flush", async () => {
    // Influx being unreachable is exactly when a disconnect happens, so this is
    // the common case, not the exotic one.
    const defaultClose = vi.fn().mockRejectedValue(new Error("influx unreachable"));
    const { client, energyClose } = primed(defaultClose);

    await client.disconnect();

    expect(energyClose).toHaveBeenCalledOnce();
  });

  it("drops the energy writer even when its own close fails", async () => {
    const { client, inner } = primed(vi.fn().mockResolvedValue(undefined));
    (inner.energyHourlyWriteApi as { close: unknown }).close = vi
      .fn()
      .mockRejectedValue(new Error("flush failed"));

    await client.disconnect();

    // Left in place it would be reused after the next connect, bound to a client
    // that no longer exists, and every point written through it would vanish.
    expect(inner.energyHourlyWriteApi).toBeNull();
  });

  it("never throws out of disconnect, whatever the writers do", async () => {
    const { client, inner } = primed(vi.fn().mockRejectedValue(new Error("a")));
    (inner.energyHourlyWriteApi as { close: unknown }).close = vi
      .fn()
      .mockRejectedValue(new Error("b"));

    await expect(client.disconnect()).resolves.toBeUndefined();
    expect(inner.writeApi).toBeNull();
    expect(inner.energyHourlyWriteApi).toBeNull();
  });
});

/**
 * `connect()` is synchronous and calls `disconnect()` without awaiting it.
 *
 * Anything `disconnect()` does after its first `await` therefore runs as a
 * microtask, after `connect()` has already installed the new config. Clearing
 * state there wipes the config that was just set, and the symptom is every
 * bucket and downsampling task failing at startup with "cannot read properties
 * of null" — a warning, so the process starts and looks healthy.
 */
describe("InfluxClient connect after a previous connection", () => {
  const logger = createLogger("silent").logger;
  const config = { url: "http://localhost:8086", token: "t", org: "o", bucket: "b" };

  function peek(client: InfluxClient) {
    return client as unknown as { config: unknown; energyHourlyWriteApi: unknown };
  }

  it("keeps its config once the deferred half of disconnect has run", async () => {
    const client = new InfluxClient(logger);
    client.connect(config);
    // Let every pending microtask from the implicit disconnect settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(peek(client).config).not.toBeNull();
    expect(client.isConnected()).toBe(true);
    expect(client.getConfig()?.bucket).toBe("b");
  });

  it("survives a reconnect with live writers in place", async () => {
    const client = new InfluxClient(logger);
    const inner = peek(client) as unknown as { writeApi: unknown; energyHourlyWriteApi: unknown };
    client.connect(config);
    inner.energyHourlyWriteApi = { close: () => Promise.resolve() };

    client.connect({ ...config, bucket: "other" });
    await Promise.resolve();
    await Promise.resolve();

    expect(client.getConfig()?.bucket).toBe("other");
    // And no writer bound to the previous client is carried over.
    expect(inner.energyHourlyWriteApi).toBeNull();
  });
});

// Spec 186 — the hourly rain points, copied unchanged into a bucket kept a year.
describe("buildRainCopyHourlyFlux", () => {
  const params = {
    hourlyBucket: "sowel-hourly",
    rainHourlyBucket: "sowel-rain-hourly",
    org: "sowel-org",
  };

  it("schedules an hourly task after the hourly downsample has run", () => {
    const flux = buildRainCopyHourlyFlux({ ...params, task: true });
    expect(flux).toContain('option task = {name: "sowel-rain-copy-hourly", every: 1h, offset: 5m}');
    // imports must precede the task option
    expect(flux.indexOf('import "date"')).toBeLessThan(flux.indexOf("option task"));
  });

  it("reaches past the scheduled time, where the hour that just ended is stamped", () => {
    const flux = buildRainCopyHourlyFlux({ ...params, task: true });
    expect(flux).toContain("range(start: -1d, stop: date.add(d: 1m, to: now()))");
  });

  it("backfills inside the retention, without a task option", () => {
    const flux = buildRainCopyHourlyFlux(params);
    expect(flux).not.toContain("option task");
    expect(flux).toContain("range(start: -364d)");
    expect(364 * 86_400).toBeLessThan(RAIN_HOURLY_RETENTION);
  });

  it("copies the rain means as they are, with nothing zone-dependent", () => {
    for (const flux of [
      buildRainCopyHourlyFlux({ ...params, task: true }),
      buildRainCopyHourlyFlux(params),
    ]) {
      expect(flux).toContain('r.category == "rain"');
      expect(flux).toContain('r._field == "mean"');
      expect(flux).toContain('to(bucket: "sowel-rain-hourly", org: "sowel-org")');
      expect(flux).not.toContain("timezone");
      expect(flux).not.toContain("aggregateWindow");
      expect(flux).not.toContain("timeShift");
    }
  });
});

describe("InfluxClient.ensureRainBuckets", () => {
  const logger = createLogger("silent").logger;

  function primed(opts: { orgId?: string | null; queryFails?: boolean } = {}) {
    const client = new InfluxClient(logger);
    const collectRows = vi.fn(() =>
      opts.queryFails ? Promise.reject(new Error("influx down")) : Promise.resolve([{}, {}]),
    );
    const inner = client as unknown as {
      client: unknown;
      config: unknown;
      getOrgId: () => Promise<string | null>;
      ensureBucket: (name: string, retention: number, orgId: string) => Promise<void>;
      ensureTask: (name: string, flux: string, orgId: string) => Promise<void>;
    };
    inner.client = { getQueryApi: () => ({ collectRows }) };
    inner.config = { url: "http://x", org: "o", bucket: "sowel", token: "t" };
    inner.getOrgId = vi.fn().mockResolvedValue(opts.orgId === undefined ? "org-1" : opts.orgId);
    const ensureBucket = vi.fn().mockResolvedValue(undefined);
    const ensureTask = vi.fn().mockResolvedValue(undefined);
    inner.ensureBucket = ensureBucket;
    inner.ensureTask = ensureTask;
    return { client, ensureBucket, ensureTask, collectRows };
  }

  it("creates the bucket and the copy task, then backfills", async () => {
    const { client, ensureBucket, ensureTask, collectRows } = primed();
    await client.ensureRainBuckets();
    expect(ensureBucket).toHaveBeenCalledWith("sowel-rain-hourly", RAIN_HOURLY_RETENTION, "org-1");
    expect(ensureTask).toHaveBeenCalledWith(
      "sowel-rain-copy-hourly",
      expect.stringContaining('from(bucket: "sowel-hourly")'),
      "org-1",
    );
    expect(collectRows).toHaveBeenCalledOnce();
    expect(collectRows.mock.calls[0]).toEqual([expect.stringContaining("range(start: -364d)")]);
  });

  it("skips the backfill when asked (before a restore)", async () => {
    const { client, ensureBucket, collectRows } = primed();
    await client.ensureRainBuckets({ backfill: false });
    expect(ensureBucket).toHaveBeenCalledOnce();
    expect(collectRows).not.toHaveBeenCalled();
  });

  it("does nothing without an org", async () => {
    const { client, ensureBucket, ensureTask } = primed({ orgId: null });
    await client.ensureRainBuckets();
    expect(ensureBucket).not.toHaveBeenCalled();
    expect(ensureTask).not.toHaveBeenCalled();
  });

  it("never throws when the backfill fails", async () => {
    const { client } = primed({ queryFails: true });
    await expect(client.ensureRainBuckets()).resolves.toBeUndefined();
  });
});
