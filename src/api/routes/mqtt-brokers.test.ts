import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerMqttBrokerRoutes } from "./mqtt-brokers.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452). These routes are admin-gated
// by an onRequest hook that runs BEFORE schema validation, so the test app
// registers its own onRequest hook first to populate an admin `request.auth`;
// that keeps requireAdmin happy and lets the schema layer be exercised.

function makeDeps() {
  const broker = { id: "b-1", name: "x", url: "mqtt://h" };
  return {
    mqttBrokerManager: {
      getAll: () => [],
      create: () => broker,
      update: () => broker,
      delete: () => undefined,
    },
  } as unknown as Parameters<typeof registerMqttBrokerRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  app.addHook("onRequest", async (request) => {
    (request as unknown as { auth: unknown }).auth = { userId: "u", role: "admin" };
  });
  registerMqttBrokerRoutes(app, makeDeps());
  return app;
}

describe("mqtt-broker routes — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (body: unknown) =>
    app.inject({ method: "POST", url: "/api/v1/mqtt-brokers", payload: body });

  it("400 { error } when name or url is missing (old `!name` / `!url`)", async () => {
    for (const body of [{ url: "mqtt://h" }, { name: "Broker" }]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("accepts whitespace-only name/url (bare `!x` did not trim)", async () => {
    const res = await post({ name: "   ", url: "   " });
    expect(res.statusCode).toBe(201);
  });

  it("201 for a valid body with extra fields", async () => {
    const res = await post({ name: "Broker", url: "mqtt://h", username: "u", bogus: 1 });
    expect(res.statusCode).toBe(201);
  });

  it("200 for a body-less PUT (old `request.body ?? {}` no-op)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/mqtt-brokers/b-1" });
    expect(res.statusCode).toBe(200);
  });
});
