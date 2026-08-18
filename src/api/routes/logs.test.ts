import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerLogRoutes } from "./logs.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Characterization tests for the #482 schema-validation conversion of the log
// routes: admin gating moved to an onRequest hook (403 before the 400), and the
// PUT /logs/level body validated by an enum instead of the hand-rolled
// `!level || !VALID_LEVELS.includes(...)` check.

const logger = createLogger("silent").logger;

interface BuildOpts {
  authed?: boolean;
  role?: "admin" | "user" | "viewer";
}

async function buildApp(opts: BuildOpts = {}) {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);

  if (opts.authed) {
    app.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role: opts.role ?? "admin" };
    });
  }

  registerLogRoutes(app, {
    logBuffer: {
      query: () => [],
      getCapacity: () => 100,
      getModules: () => [],
    } as never,
    logger,
  });
  await app.ready();
  return app;
}

describe("log routes (schema validation, #482)", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("403s a non-admin on GET /logs (admin gate)", async () => {
    app = await buildApp({ authed: true, role: "user" });
    const res = await app.inject({ method: "GET", url: "/api/v1/logs" });
    expect(res.statusCode).toBe(403);
  });

  it("returns the buffer to an admin on GET /logs", async () => {
    app = await buildApp({ authed: true, role: "admin" });
    const res = await app.inject({ method: "GET", url: "/api/v1/logs" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("entries");
  });

  it("403s a non-admin BEFORE body validation on PUT /logs/level (precedence preserved)", async () => {
    app = await buildApp({ authed: true, role: "user" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/logs/level",
      payload: { level: "not-a-level" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400s an admin with an invalid level, in { error } shape", async () => {
    app = await buildApp({ authed: true, role: "admin" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/logs/level",
      payload: { level: "verbose" },
    });
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().error).toBe("string");
  });

  it("400s an admin with a missing level", async () => {
    app = await buildApp({ authed: true, role: "admin" });
    const res = await app.inject({ method: "PUT", url: "/api/v1/logs/level", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid level change and reports the previous level", async () => {
    app = await buildApp({ authed: true, role: "admin" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/logs/level",
      payload: { level: "debug" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().level).toBe("debug");
    expect(res.json()).toHaveProperty("previous");
  });
});
