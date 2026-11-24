import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { registerHistoryRoutes } from "./history.js";
import { createLogger } from "../../core/logger.js";

// Spec 211 — `queryHistory` now also returns `source`, for the recipe path
// only. Pin the REST payload so it never leaks.

const logger = createLogger("silent").logger;

function buildApp() {
  const queryApi = {
    iterateRows: () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          values: { _time: "2026-11-17T14:00:00Z", mean: 19, min: 18, max: 20 },
          tableMeta: { toObject: (v: unknown) => v },
        };
      },
    }),
  };
  const app = Fastify({ logger: false });
  registerHistoryRoutes(app, {
    historyWriter: {} as never,
    influxClient: {
      isConnected: () => true,
      getConfig: () => ({ org: "o", bucket: "sowel" }),
      getClient: () => ({ getQueryApi: () => queryApi }),
    } as never,
    equipmentManager: {
      getById: () => ({ id: "eq-1" }),
      getDataBindingsWithValues: () => [
        { alias: "temperature", type: "number", category: "temperature" },
      ],
    } as never,
    eventBus: { on: () => () => {} } as never,
    logger,
  });
  return app;
}

describe("GET /api/v1/history/:equipmentId/:alias — payload (spec 211)", () => {
  let app: ReturnType<typeof buildApp>;
  afterEach(async () => await app.close());

  it("answers points, resolution, dataType and category only — no `source`", async () => {
    app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/history/eq-1/temperature?aggregation=1h&from=-24h",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["category", "dataType", "points", "resolution"]);
    expect(body.points).toHaveLength(1);
  });
});
