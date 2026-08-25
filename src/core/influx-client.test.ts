import { describe, expect, it, vi } from "vitest";
import { InfluxClient } from "./influx-client.js";
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
