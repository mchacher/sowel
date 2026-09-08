import Fastify from "fastify";
import { describe, it, expect } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerHealthRoutes } from "./health.js";
import type { JwtPayload } from "../../auth/auth-service.js";

// Issue #926 — `/api/v1/health` stays in PUBLIC_ROUTES so readiness probes and
// uptime monitors keep working without credentials, but the reconnaissance
// material (engine version, installed plugin list, device counts) is served
// only to an authenticated caller. The auth middleware skips public routes
// entirely, so the route resolves the bearer token itself.

const logger = createLogger("silent").logger;

const ADMIN: JwtPayload = { userId: "u1", role: "admin" } as JwtPayload;

/** Accepts exactly one JWT ("good-jwt") and one API token ("swl_good"). */
const authService = {
  verifyAccessToken: (token: string): JwtPayload => {
    if (token !== "good-jwt") throw new Error("invalid or expired");
    return ADMIN;
  },
  verifyApiToken: (token: string): JwtPayload | null => (token === "swl_good" ? ADMIN : null),
} as never;

function buildApp() {
  const app = Fastify({ logger: false });
  registerHealthRoutes(app, {
    deviceManager: {
      getStatusCounts: () => ({ online: 100, offline: 4, unknown: 6 }),
      getDeviceCount: () => 110,
    } as never,
    integrationRegistry: {
      getAllInfo: () => [
        { id: "zigbee2mqtt", status: "connected" },
        { id: "somfy-rts", status: "connected" },
      ],
    } as never,
    authService,
    logger,
  });
  return app;
}

async function get(headers?: Record<string, string>) {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/v1/health", headers });
  await app.close();
  return res;
}

describe("GET /api/v1/health", () => {
  it("answers an anonymous caller with liveness only", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.uptime).toMatchObject({ ms: expect.any(Number), human: expect.any(String) });

    // The three fields the issue is about. A leaked version pins the instance
    // to an exact release; the plugin ids reveal the protocols in play.
    expect(body).not.toHaveProperty("version");
    expect(body).not.toHaveProperty("integrations");
    expect(body).not.toHaveProperty("devices");
  });

  it("serves the full payload to a JWT caller", async () => {
    const res = await get({ authorization: "Bearer good-jwt" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toEqual(expect.any(String));
    expect(body.integrations).toEqual({
      zigbee2mqtt: { status: "connected" },
      "somfy-rts": { status: "connected" },
    });
    expect(body.devices).toEqual({ total: 110, online: 100, offline: 4, unknown: 6 });
  });

  it("serves the full payload to an API-token caller", async () => {
    const res = await get({ authorization: "Bearer swl_good" });
    expect(res.statusCode).toBe(200);
    expect(res.json().integrations).toHaveProperty("zigbee2mqtt");
  });

  // A monitor configured with a token that later expires must keep reporting
  // the instance as up, so a bad token degrades to anonymous, never to a 401.
  it.each([
    ["an expired JWT", "Bearer stale-jwt"],
    ["a revoked API token", "Bearer swl_revoked"],
    ["a malformed header", "good-jwt"],
  ])("degrades to liveness for %s instead of rejecting", async (_label, authorization) => {
    const res = await get({ authorization });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("version");
  });
});
