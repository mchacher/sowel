import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerSettingsRoutes } from "./settings.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Characterization tests for the #482 schema-validation conversion of the
// settings routes: admin gating moved to an onRequest hook (403 before the body
// schema's 400), and the PUT body validated by `additionalProperties: string`
// instead of the hand-rolled per-entry typeof check.

const logger = createLogger("silent").logger;

interface BuildOpts {
  authed?: boolean;
  role?: "admin" | "user" | "viewer";
}

async function buildApp(opts: BuildOpts = {}) {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);

  // Registered before the routes so it runs first: it stands in for the global
  // auth middleware that populates request.auth ahead of the route's own
  // onRequest admin gate.
  if (opts.authed) {
    app.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role: opts.role ?? "admin" };
    });
  }

  const store: Record<string, string> = {};
  registerSettingsRoutes(app, {
    settingsManager: {
      getAll: () => ({ ...store }),
      get: (k: string) => store[k],
      setMany: (entries: Record<string, string>) => Object.assign(store, entries),
    } as never,
    eventBus: { emit: () => {} } as never,
    auditLogger: { log: () => {} } as never,
    userManager: { getById: () => ({ username: "admin" }) } as never,
    logger,
  });

  // Stand-in for a foreign route that borrows the /settings namespace (e.g.
  // energy tariff, energy.ts): the settings admin hook must NOT gate it.
  app.get("/api/v1/settings/energy/tariff", async () => ({ ok: true }));

  await app.ready();
  return app;
}

describe("settings routes (schema validation, #482)", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("403s a non-admin on GET /settings (admin gate)", async () => {
    app = await buildApp({ authed: true, role: "user" });
    const res = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(res.statusCode).toBe(403);
  });

  it("returns all settings to an admin on GET /settings", async () => {
    app = await buildApp({ authed: true, role: "admin" });
    const res = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it("403s a non-admin BEFORE body validation on PUT (precedence preserved)", async () => {
    app = await buildApp({ authed: true, role: "user" });
    // Malformed body (number value) from a non-admin must 403, not 400.
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/settings",
      payload: { "some.key": 123 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400s an admin with a non-string value, in { error } shape", async () => {
    app = await buildApp({ authed: true, role: "admin" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/settings",
      payload: { "home.timezone": 42 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty("error");
    expect(typeof res.json().error).toBe("string");
  });

  it("accepts a valid admin write and persists it", async () => {
    app = await buildApp({ authed: true, role: "admin" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/settings",
      payload: { "home.timezone": "Europe/Paris" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    const after = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(after.json()).toEqual({ "home.timezone": "Europe/Paris" });
  });

  it("accepts an empty object (no-op write)", async () => {
    app = await buildApp({ authed: true, role: "admin" });
    const res = await app.inject({ method: "PUT", url: "/api/v1/settings", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
  });

  it("does NOT admin-gate a foreign route sharing the /settings prefix", async () => {
    // The hook matches the exact settings path, so /api/v1/settings/energy/tariff
    // (owned by energy.ts, which self-guards) is reachable by a non-admin here.
    app = await buildApp({ authed: true, role: "user" });
    const res = await app.inject({ method: "GET", url: "/api/v1/settings/energy/tariff" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
