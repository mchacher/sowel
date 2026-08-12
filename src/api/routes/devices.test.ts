import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerDeviceRoutes } from "./devices.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452): PUT /devices/:id required at
// least one of name/zoneId (old `name === undefined && zoneId === undefined`),
// so a body-less/empty/neither-field request stayed a 400.

function makeDeps() {
  const device = { id: "d-1", name: "x" };
  return {
    deviceManager: {
      getAllWithData: () => [],
      getByIdWithDetails: () => device,
      getById: () => device,
      update: () => device,
      delete: () => true,
    },
    batteryMonitor: undefined,
    logger: createLogger("silent").logger,
  } as unknown as Parameters<typeof registerDeviceRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  registerDeviceRoutes(app, makeDeps());
  return app;
}

describe("device routes — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const put = (body: unknown) =>
    app.inject({ method: "PUT", url: "/api/v1/devices/d-1", payload: body });

  it("400 { error } when neither name nor zoneId is provided", async () => {
    for (const body of [{}, { foo: 1 }]) {
      const res = await put(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("400 for a body-less PUT (old `request.body ?? {}` -> {} -> 400)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/devices/d-1" });
    expect(res.statusCode).toBe(400);
  });

  it("200 when at least one of name/zoneId is present (incl. null zoneId)", async () => {
    expect((await put({ name: "Renamed" })).statusCode).toBe(200);
    expect((await put({ zoneId: null })).statusCode).toBe(200);
    expect((await put({ zoneId: "z-1", extra: 1 })).statusCode).toBe(200);
  });
});
