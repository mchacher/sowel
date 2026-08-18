import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerMeRoutes } from "./me.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Characterization tests for the #482 schema-validation conversion of the /me
// routes: the PUT/POST bodies are validated by schema instead of the hand-rolled
// checks. These routes are user-level (allowlisted); authentication is enforced
// by the global auth middleware in production. Existence (404) and semantic
// (401 "wrong password") checks stay in the handler, after the body.

const logger = createLogger("silent").logger;

interface BuildOpts {
  authed?: boolean;
}

const currentUser = {
  id: "u1",
  username: "bob",
  displayName: "Bob",
  role: "user" as const,
  enabled: true,
  passwordHash: "hash",
};

async function buildApp(opts: BuildOpts = {}) {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);

  if (opts.authed) {
    app.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role: "user" };
    });
  }

  const created: unknown[] = [];
  registerMeRoutes(app, {
    authService: {
      getUserApiTokens: () => [],
      createApiToken: (_userId: string, name: string) => {
        created.push(name);
        return { id: "t1", token: "swl_secret" };
      },
      deleteApiToken: () => true,
    } as never,
    mfaService: { revokeAllTrustedDevices: () => {} } as never,
    userManager: {
      getById: () => currentUser,
      getByUsername: () => currentUser,
      updateUser: (id: string, patch: Record<string, unknown>) => ({
        ...currentUser,
        ...patch,
        id,
      }),
      updatePreferences: () => {},
      // Only "correct" verifies, so a wrong current password can be exercised.
      verifyPassword: async (_hash: string, pw: string) => pw === "correct",
      updatePassword: async () => {},
    } as never,
    auditLogger: { log: () => {} } as never,
    logger,
  });
  await app.ready();
  return { app, created };
}

describe("me routes (schema validation, #482)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>["app"] | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("401s an unauthenticated PUT /me (in-handler guard)", async () => {
    const built = await buildApp({ authed: false });
    app = built.app;
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me",
      payload: { displayName: "X" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s PUT /me with a missing displayName, in { error } shape", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({ method: "PUT", url: "/api/v1/me", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().error).toBe("string");
  });

  it("updates the display name on a valid PUT /me", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me",
      payload: { displayName: "Bobby" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("Bobby");
  });

  it("400s PUT /me/preferences with a missing preferences object", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({ method: "PUT", url: "/api/v1/me/preferences", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid PUT /me/preferences", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      payload: { preferences: { theme: "dark" } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("400s PUT /me/password when newPassword is too short", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/password",
      payload: { currentPassword: "correct", newPassword: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401s PUT /me/password with a wrong current password (semantic, after body)", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/password",
      payload: { currentPassword: "wrong", newPassword: "longenough" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("changes the password on a valid PUT /me/password", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/password",
      payload: { currentPassword: "correct", newPassword: "longenough" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
  });

  it("400s POST /me/tokens with a missing name", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({ method: "POST", url: "/api/v1/me/tokens", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("creates an API token on a valid POST /me/tokens (201)", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/me/tokens",
      payload: { name: "my-token" },
    });
    expect(res.statusCode).toBe(201);
    expect(built.created).toEqual(["my-token"]);
  });
});
