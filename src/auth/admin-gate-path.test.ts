/**
 * Every admin gate bound to a URL prefix, driven through a real router.
 *
 * The gates compared `request.url`, the RAW request target, while find-my-way
 * percent-decodes before matching. So `GET /api/v1/%62ackup` reached the
 * `/api/v1/backup` handler while the hook saw a path it did not recognise and
 * let it through. The global role gate does not cover the gap: it only guards
 * MUTATING methods, so an admin-only GET had nothing else standing behind it.
 *
 * These tests are written against the real hook bodies rather than the helper,
 * because the helper being correct was never the question: the question is
 * whether every gate uses it.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { pathIs, pathIsUnder, decodedPath, requireAdmin } from "./auth-middleware.js";
import type { UserRole } from "../shared/types.js";

/**
 * A stand-in for one protected surface: the same hook shape the route files
 * use, in front of a handler that returns something worth stealing.
 */
async function buildGate(opts: {
  base: string;
  exact?: boolean;
  role: UserRole;
  routes: string[];
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", async (request) => {
    request.auth = { userId: "u1", role: opts.role };
  });
  app.addHook("onRequest", async (request, reply) => {
    const hit = opts.exact ? pathIs(request, opts.base) : pathIsUnder(request, opts.base);
    if (hit) requireAdmin(request, reply);
  });
  for (const r of opts.routes) app.get(r, async () => ({ secret: "admin-only-payload" }));
  await app.ready();
  return app;
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

/**
 * One entry per admin gate in the codebase, so adding a route file with a new
 * gate and forgetting this list is visible: the count is asserted below.
 */
const GATES: { name: string; base: string; exact?: boolean; routes: string[] }[] = [
  { name: "backup", base: "/api/v1/backup", routes: ["/api/v1/backup", "/api/v1/backup/local"] },
  { name: "logs", base: "/api/v1/logs", routes: ["/api/v1/logs", "/api/v1/logs/modules"] },
  { name: "settings", base: "/api/v1/settings", exact: true, routes: ["/api/v1/settings"] },
  { name: "mqtt-brokers", base: "/api/v1/mqtt-brokers", routes: ["/api/v1/mqtt-brokers"] },
  { name: "mqtt-publishers", base: "/api/v1/mqtt-publishers", routes: ["/api/v1/mqtt-publishers"] },
  {
    name: "notification-publishers",
    base: "/api/v1/notification-publishers",
    routes: ["/api/v1/notification-publishers"],
  },
  { name: "users", base: "/api/v1/users", routes: ["/api/v1/users", "/api/v1/users/u1"] },
];

/** Percent-encode the first character of the last path segment. */
function encodeFirstCharOfLastSegment(path: string): string {
  const parts = path.split("/");
  const last = parts[parts.length - 1];
  const code = last.charCodeAt(0).toString(16).padStart(2, "0");
  parts[parts.length - 1] = "%" + code + last.slice(1);
  return parts.join("/");
}

describe("admin gates resist a percent-encoded path", () => {
  for (const gate of GATES) {
    for (const route of gate.routes) {
      it(`${gate.name}: 403s a standard user on ${route} however it is spelled`, async () => {
        app = await buildGate({ ...gate, role: "standard" });
        const encoded = encodeFirstCharOfLastSegment(route);
        expect(encoded).not.toBe(route); // sanity: we really did encode something

        const plain = await app.inject({ method: "GET", url: route });
        const spelled = await app.inject({ method: "GET", url: encoded });

        expect(plain.statusCode).toBe(403);
        // Before the fix this was 200 with the payload.
        expect(spelled.statusCode).toBe(403);
        expect(spelled.body).not.toContain("admin-only-payload");
      });

      it(`${gate.name}: still serves an admin on ${route} however it is spelled`, async () => {
        // The other half: the gate must not have become a blanket denial.
        app = await buildGate({ ...gate, role: "admin" });
        const encoded = encodeFirstCharOfLastSegment(route);
        expect((await app.inject({ method: "GET", url: route })).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: encoded })).statusCode).toBe(200);
      });
    }
  }

  it("covers every gate in the codebase", () => {
    // Bumping this is the moment to add the new gate above.
    expect(GATES).toHaveLength(7);
  });
});

describe("decodedPath", () => {
  const req = (url: string) => ({ url }) as never;

  it("strips the query string", () => {
    expect(decodedPath(req("/api/v1/logs?level=error"))).toBe("/api/v1/logs");
  });

  it("decodes exactly once, matching the router", () => {
    // The router decodes once too, so a double-encoded path 404s there. Looping
    // until stable would make this function see a path the router never will,
    // and turn a 404 into a 403 on a route that does not exist.
    expect(decodedPath(req("/api/v1/%62ackup"))).toBe("/api/v1/backup");
    expect(decodedPath(req("/api/v1/%2562ackup"))).toBe("/api/v1/%62ackup");
  });

  it("falls back to the raw path on a malformed sequence", () => {
    // `%zz` throws in decodeURIComponent. The router will not match it either.
    expect(decodedPath(req("/api/v1/%zz"))).toBe("/api/v1/%zz");
  });
});

describe("pathIsUnder", () => {
  const req = (url: string) => ({ url }) as never;

  it("matches the base and its subtree", () => {
    expect(pathIsUnder(req("/api/v1/users"), "/api/v1/users")).toBe(true);
    expect(pathIsUnder(req("/api/v1/users/u1"), "/api/v1/users")).toBe(true);
  });

  it("does not match a sibling that merely shares the prefix", () => {
    // `startsWith(base)` without the separator, which four of these gates used,
    // would have gated a future /api/v1/users-export too. Tighter, and the
    // tightening is on routes that do not exist.
    expect(pathIsUnder(req("/api/v1/users-export"), "/api/v1/users")).toBe(false);
    expect(pathIsUnder(req("/api/v1/usersx"), "/api/v1/users")).toBe(false);
  });

  it("is not fooled by an encoded separator", () => {
    // %2f does not decode into a path separator for routing purposes either:
    // the router sees a single segment and 404s.
    expect(pathIsUnder(req("/api/v1/users%2fu1"), "/api/v1/users")).toBe(true);
  });
});

describe("pathIs", () => {
  const req = (url: string) => ({ url }) as never;

  it("matches only the exact path, encoded or not", () => {
    // settings uses the exact form on purpose, so that
    // /api/v1/settings/energy/tariff keeps self-guarding.
    expect(pathIs(req("/api/v1/settings"), "/api/v1/settings")).toBe(true);
    expect(pathIs(req("/api/v1/%73ettings"), "/api/v1/settings")).toBe(true);
    expect(pathIs(req("/api/v1/settings/energy/tariff"), "/api/v1/settings")).toBe(false);
  });
});
