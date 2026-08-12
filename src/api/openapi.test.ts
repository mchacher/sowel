import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import { createLogger } from "../core/logger.js";
import { registerZoneRoutes } from "./routes/zones.js";
import { installValidationErrorHandler, validationAjvOptions } from "./error-handler.js";

// Verifies the issue #452 OpenAPI follow-up: @fastify/swagger builds an OpenAPI
// 3 document from the route body schemas added during the validation rollout,
// and the GET /api/v1/openapi.json endpoint serves it. Mirrors the server wiring
// (swagger registered before routes) on a single converted domain.

function zonesDeps() {
  const zone = { id: "z-1", name: "x", parentId: null };
  return {
    zoneManager: { create: () => zone, update: () => zone },
    zoneAggregator: {},
    equipmentManager: {},
    logger: createLogger("silent").logger,
  } as unknown as Parameters<typeof registerZoneRoutes>[1];
}

async function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  await app.register(swagger, {
    openapi: { info: { title: "Sowel API", version: "0.0.0-test" } },
  });
  registerZoneRoutes(app, zonesDeps());
  app.get("/api/v1/openapi.json", async () => app.swagger());
  await app.ready();
  return app;
}

describe("OpenAPI spec generation (issue #452 follow-up)", () => {
  it("builds an OpenAPI 3 document that includes a converted route's body schema", async () => {
    const app = await buildApp();
    const spec = app.swagger() as {
      openapi: string;
      info: { title: string };
      paths: Record<string, Record<string, { requestBody?: unknown }>>;
    };
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe("Sowel API");
    // POST /api/v1/zones carries createZoneBodySchema -> a requestBody is emitted.
    expect(spec.paths["/api/v1/zones"]?.post?.requestBody).toBeDefined();
    await app.close();
  });

  it("serves the spec as JSON at GET /api/v1/openapi.json", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toMatch(/^3\./);
    expect(Object.keys(body.paths).length).toBeGreaterThan(0);
    await app.close();
  });
});
