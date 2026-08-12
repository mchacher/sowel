import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerChartRoutes } from "./charts.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452): pin the accept/reject matrix
// and { error } 400 shape of the POST/PUT /charts checks so the schema move is
// provably regression-free.

function makeDeps() {
  const chart = { id: "c-1", name: "x", config: {} };
  return {
    chartManager: {
      createChart: () => chart,
      updateChart: () => chart,
    },
  } as unknown as Parameters<typeof registerChartRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  registerChartRoutes(app, makeDeps());
  return app;
}

describe("POST /api/v1/charts — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (body: unknown) =>
    app.inject({ method: "POST", url: "/api/v1/charts", payload: body });

  it("400 { error } when name is missing or empty (old `!name`)", async () => {
    for (const body of [{ config: {} }, { name: "", config: {} }]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("accepts a whitespace-only name (bare `!name` did not trim)", async () => {
    const res = await post({ name: "   ", config: {} });
    expect(res.statusCode).toBe(201);
  });

  it("400 when config is missing (old `!config`)", async () => {
    const res = await post({ name: "Chart" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("201 for a valid body with extra fields", async () => {
    const res = await post({ name: "Chart", config: { series: [] }, bogus: 1 });
    expect(res.statusCode).toBe(201);
  });
});

describe("PUT /api/v1/charts/:id — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const put = (body: unknown) =>
    app.inject({ method: "PUT", url: "/api/v1/charts/c-1", payload: body });

  it("200 for any partial body (old PUT had no validation, `request.body ?? {}`)", async () => {
    expect((await put({ name: "Renamed" })).statusCode).toBe(200);
    expect((await put({ config: { series: [] } })).statusCode).toBe(200);
    // Old accepted a blank name on PUT (no check): must stay accepted.
    expect((await put({ name: "" })).statusCode).toBe(200);
  });

  it("200 for a body-less PUT (old `request.body ?? {}` no-op)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/charts/c-1" });
    expect(res.statusCode).toBe(200);
  });
});
