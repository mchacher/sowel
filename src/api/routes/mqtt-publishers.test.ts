import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerMqttPublisherRoutes } from "./mqtt-publishers.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452). Admin-gated by an onRequest
// hook (runs before schema validation), so the test app injects an admin
// request.auth first.

function makeDeps() {
  const publisher = { id: "p-1", name: "x", brokerId: "b-1", topic: "t" };
  const mapping = { id: "m-1" };
  return {
    mqttPublisherManager: {
      getAllWithMappings: () => [],
      getByIdWithMappings: () => publisher,
      getById: () => publisher,
      create: () => publisher,
      update: () => publisher,
      delete: () => undefined,
      addMapping: () => mapping,
      updateMapping: () => mapping,
      removeMapping: () => undefined,
    },
    mqttPublishService: { publishSnapshotForPublisher: () => 0 },
  } as unknown as Parameters<typeof registerMqttPublisherRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  app.addHook("onRequest", async (request) => {
    (request as unknown as { auth: unknown }).auth = { userId: "u", role: "admin" };
  });
  registerMqttPublisherRoutes(app, makeDeps());
  return app;
}

describe("mqtt-publisher routes — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (url: string, body: unknown) => app.inject({ method: "POST", url, payload: body });

  it("POST /mqtt-publishers 400 when name, brokerId or topic is missing", async () => {
    for (const body of [
      { brokerId: "b-1", topic: "t" },
      { name: "P", topic: "t" },
      { name: "P", brokerId: "b-1" },
    ]) {
      const res = await post("/api/v1/mqtt-publishers", body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("POST /mqtt-publishers 201 for a valid body", async () => {
    const res = await post("/api/v1/mqtt-publishers", { name: "P", brokerId: "b-1", topic: "t" });
    expect(res.statusCode).toBe(201);
  });

  it("POST mappings 400 when a required source field is missing", async () => {
    for (const body of [
      { sourceType: "equipment", sourceId: "e-1", sourceKey: "k" },
      { publishKey: "pk", sourceId: "e-1", sourceKey: "k" },
      { publishKey: "pk", sourceType: "equipment", sourceKey: "k" },
      { publishKey: "pk", sourceType: "equipment", sourceId: "e-1" },
    ]) {
      const res = await post("/api/v1/mqtt-publishers/p-1/mappings", body);
      expect(res.statusCode).toBe(400);
    }
  });

  it("POST mappings 201 for a valid body", async () => {
    const res = await post("/api/v1/mqtt-publishers/p-1/mappings", {
      publishKey: "pk",
      sourceType: "equipment",
      sourceId: "e-1",
      sourceKey: "k",
    });
    expect(res.statusCode).toBe(201);
  });
});
