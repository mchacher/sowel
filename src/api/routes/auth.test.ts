import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerAuthRoutes } from "./auth.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452 / #482) for the converted auth
// routes (login, refresh, setup). logout stays hand-rolled and is not covered.

function makeDeps(overrides: { hasUsers?: boolean } = {}) {
  const tokens = { accessToken: "a", refreshToken: "r" };
  return {
    authService: {
      login: async () => tokens,
      refresh: async () => tokens,
      logout: () => undefined,
    },
    userManager: {
      hasUsers: () => overrides.hasUsers ?? true,
      getByUsername: () => ({ id: "u-1", username: "admin" }),
      getById: () => null,
      createUser: async () => ({ id: "u-1" }),
    },
    auditLogger: { log: () => undefined },
    logger: createLogger("silent").logger,
  } as unknown as Parameters<typeof registerAuthRoutes>[1];
}

function buildApp(overrides: { hasUsers?: boolean } = {}) {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  registerAuthRoutes(app, makeDeps(overrides));
  return app;
}

describe("auth routes — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (url: string, body: unknown) => app.inject({ method: "POST", url, payload: body });

  it("POST /auth/login 400 { error } when username or password is missing", async () => {
    for (const body of [{ password: "pw" }, { username: "admin" }]) {
      const res = await post("/api/v1/auth/login", body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("POST /auth/login 200 for a valid body", async () => {
    const res = await post("/api/v1/auth/login", { username: "admin", password: "pw" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("accessToken");
  });

  it("POST /auth/refresh 400 when refreshToken is missing", async () => {
    const res = await post("/api/v1/auth/refresh", {});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("POST /auth/refresh 200 for a valid body", async () => {
    const res = await post("/api/v1/auth/refresh", { refreshToken: "r" });
    expect(res.statusCode).toBe(200);
  });

  // #482 — /auth/setup: the "already completed" 403 must beat the body 400.
  it("POST /auth/setup 403s (before body validation) when users already exist", async () => {
    // Outer app has hasUsers:true. A malformed body must still 403, not 400.
    const res = await post("/api/v1/auth/setup", { username: "" });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /auth/setup — first run (characterization, #482)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp({ hasUsers: false });
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (body: unknown) =>
    app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: body });

  it("400 { error } when a required field is missing", async () => {
    const res = await post({ username: "admin", password: "longenough" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when the password is shorter than 6 chars", async () => {
    const res = await post({ username: "admin", password: "short", displayName: "Admin" });
    expect(res.statusCode).toBe(400);
  });

  it("201 and auto-login for a valid first-run setup", async () => {
    const res = await post({ username: "admin", password: "longenough", displayName: "Admin" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveProperty("accessToken");
  });
});
