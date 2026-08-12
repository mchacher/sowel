import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerAuthRoutes } from "./auth.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452) for the converted auth routes
// (login, refresh). setup/logout stay hand-rolled and are not covered here.

function makeDeps() {
  const tokens = { accessToken: "a", refreshToken: "r" };
  return {
    authService: {
      login: async () => tokens,
      refresh: async () => tokens,
      logout: () => undefined,
    },
    userManager: {
      hasUsers: () => true,
      getByUsername: () => ({ id: "u-1", username: "admin" }),
      getById: () => null,
    },
    auditLogger: { log: () => undefined },
    logger: createLogger("silent").logger,
  } as unknown as Parameters<typeof registerAuthRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  registerAuthRoutes(app, makeDeps());
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
});
