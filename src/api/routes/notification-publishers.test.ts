import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerNotificationPublisherRoutes } from "./notification-publishers.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452). Admin-gated by an onRequest
// hook (runs before schema validation), so the test app injects an admin
// request.auth first.

function makeDeps() {
  const publisher = { id: "np-1", name: "x" };
  const mapping = { id: "m-1" };
  return {
    notificationPublisherManager: {
      getAllWithMappings: () => [],
      getByIdWithMappings: () => publisher,
      create: () => publisher,
      update: () => publisher,
      delete: () => undefined,
      addMapping: () => mapping,
      updateMapping: () => mapping,
      removeMapping: () => undefined,
    },
    notificationPublishService: {
      testChannel: async () => undefined,
      testPublisher: async () => true,
    },
  } as unknown as Parameters<typeof registerNotificationPublisherRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  app.addHook("onRequest", async (request) => {
    (request as unknown as { auth: unknown }).auth = { userId: "u", role: "admin" };
  });
  registerNotificationPublisherRoutes(app, makeDeps());
  return app;
}

describe("notification-publisher routes — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (url: string, body: unknown) => app.inject({ method: "POST", url, payload: body });

  it("POST publisher 400 { error } when name is missing (old `!name`)", async () => {
    const res = await post("/api/v1/notification-publishers", { channelType: "telegram" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("POST publisher 201 with only a name (channelType/channelConfig defaulted)", async () => {
    const res = await post("/api/v1/notification-publishers", { name: "Notif" });
    expect(res.statusCode).toBe(201);
  });

  it("POST mappings 400 when a required field is missing", async () => {
    for (const body of [
      { sourceType: "equipment", sourceId: "e-1", sourceKey: "k" },
      { message: "hi", sourceId: "e-1", sourceKey: "k" },
      { message: "hi", sourceType: "equipment", sourceKey: "k" },
      { message: "hi", sourceType: "equipment", sourceId: "e-1" },
    ]) {
      const res = await post("/api/v1/notification-publishers/np-1/mappings", body);
      expect(res.statusCode).toBe(400);
    }
  });

  it("POST mappings 201 for a valid body", async () => {
    const res = await post("/api/v1/notification-publishers/np-1/mappings", {
      message: "hi",
      sourceType: "equipment",
      sourceId: "e-1",
      sourceKey: "k",
    });
    expect(res.statusCode).toBe(201);
  });
});
