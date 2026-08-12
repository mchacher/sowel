import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerUserRoutes } from "./users.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452) for POST /users. These routes
// are admin-gated by an onRequest hook (runs before schema validation), so the
// test app injects an admin request.auth first. PUT /users is not converted.

function makeDeps() {
  const user = { id: "u-1", username: "bob", role: "standard" };
  return {
    userManager: {
      getAll: () => [user],
      getById: () => user,
      getByUsername: () => null,
      createUser: async () => user,
      updateUser: async () => user,
    },
    auditLogger: { log: () => undefined },
    logger: createLogger("silent").logger,
  } as unknown as Parameters<typeof registerUserRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  app.addHook("onRequest", async (request) => {
    (request as unknown as { auth: unknown }).auth = { userId: "admin", role: "admin" };
  });
  registerUserRoutes(app, makeDeps());
  return app;
}

describe("POST /api/v1/users — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (body: unknown) =>
    app.inject({ method: "POST", url: "/api/v1/users", payload: body });

  it("400 { error } when username, password or displayName is missing", async () => {
    for (const body of [
      { password: "secret1", displayName: "Bob" },
      { username: "bob", displayName: "Bob" },
      { username: "bob", password: "secret1" },
    ]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("400 when password is shorter than 6 characters", async () => {
    const res = await post({ username: "bob", password: "12345", displayName: "Bob" });
    expect(res.statusCode).toBe(400);
  });

  it("400 when role is not admin or standard", async () => {
    const res = await post({
      username: "bob",
      password: "secret1",
      displayName: "Bob",
      role: "superuser",
    });
    expect(res.statusCode).toBe(400);
  });

  it("201 for a valid body, with or without an explicit role", async () => {
    expect(
      (await post({ username: "bob", password: "secret1", displayName: "Bob" })).statusCode,
    ).toBe(201);
    expect(
      (
        await post({
          username: "bob",
          password: "secret1",
          displayName: "Bob",
          role: "admin",
        })
      ).statusCode,
    ).toBe(201);
  });
});
