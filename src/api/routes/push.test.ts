import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { registerPushRoutes } from "./push.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Characterization tests for the #482 schema-validation conversion of the push
// subscription routes: the POST/DELETE bodies are validated by schema
// (endpoint + browser keys, non-empty) instead of the hand-rolled checks.
// Authentication stays enforced by the global middleware; here it is the
// in-handler `!request.auth` guard that answers 401 in isolation.

interface BuildOpts {
  authed?: boolean;
}

async function buildApp(opts: BuildOpts = {}) {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);

  if (opts.authed) {
    app.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role: "user" };
    });
  }

  const upserts: unknown[] = [];
  const deletes: string[] = [];
  registerPushRoutes(app, {
    pushSubscriptionManager: {
      listByUser: () => [],
      upsert: (_userId: string, sub: unknown) => {
        upserts.push(sub);
        return { id: "sub1", ...(sub as object) };
      },
      deleteByEndpoint: (endpoint: string) => {
        deletes.push(endpoint);
      },
    } as never,
    vapidKeys: { publicKey: "pub", privateKey: "priv" } as never,
  });
  await app.ready();
  return { app, upserts, deletes };
}

describe("push subscription routes (schema validation, #482)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>["app"] | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  const validSubscription = {
    endpoint: "https://push.example/abc",
    keys: { p256dh: "key-p256dh", auth: "key-auth" },
    userAgent: "Firefox",
  };

  it("401s an unauthenticated POST (auth guard)", async () => {
    const built = await buildApp({ authed: false });
    app = built.app;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscriptions",
      payload: validSubscription,
    });
    expect(res.statusCode).toBe(401);
  });

  it("registers a valid subscription (201)", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscriptions",
      payload: validSubscription,
    });
    expect(res.statusCode).toBe(201);
    expect(built.upserts).toHaveLength(1);
  });

  it("400s a POST missing the browser keys, in { error } shape", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscriptions",
      payload: { endpoint: "https://push.example/abc" },
    });
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().error).toBe("string");
  });

  it("400s a POST with an empty endpoint (non-empty rule preserved)", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscriptions",
      payload: { endpoint: "", keys: { p256dh: "a", auth: "b" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s a DELETE with no endpoint", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/push/subscriptions",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("removes a subscription on a valid DELETE (204)", async () => {
    const built = await buildApp({ authed: true });
    app = built.app;
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/push/subscriptions",
      payload: { endpoint: "https://push.example/abc" },
    });
    expect(res.statusCode).toBe(204);
    expect(built.deletes).toEqual(["https://push.example/abc"]);
  });
});
