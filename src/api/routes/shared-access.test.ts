import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { describe, it, expect, afterEach } from "vitest";
import { registerSharedAccessRoutes } from "./shared-access.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";
import { isPublicRoute } from "../../auth/auth-middleware.js";
import {
  buildSharedAccessHarness,
  silentLogger,
  type SharedAccessHarness,
} from "../../test-helpers/shared-access.js";
import { GUEST_JS } from "../../shared-access/guest-page.js";
import type { UserRole } from "../../shared/types.js";

let h: SharedAccessHarness;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;

async function buildApp(opts: { enabled?: boolean; role?: UserRole } = {}) {
  h = buildSharedAccessHarness({ enabled: opts.enabled });
  const fastify = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(fastify);
  // The server's global limit, so a test proves the public routes escape it.
  await fastify.register(rateLimit, { max: 5, timeWindow: "1 minute" });
  // Stands in for the global auth middleware, which skips public routes.
  fastify.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/") && !isPublicRoute(request.url)) {
      request.auth = { userId: "u1", role: opts.role ?? "admin" };
    }
  });
  registerSharedAccessRoutes(fastify, {
    sharedAccessManager: h.manager,
    userManager: { getById: () => ({ username: "adrien" }) } as never,
    logger: silentLogger,
  });
  await fastify.ready();
  return fastify;
}

afterEach(async () => {
  if (app) await app.close();
  app = null;
  h?.manager.stop();
});

describe("shared access routes", () => {
  it("answers the page and the owner's API as unknown routes while the setting is off", async () => {
    app = await buildApp({ enabled: false });
    for (const url of [
      "/access/",
      "/access/app.js",
      "/access/api/session",
      "/api/v1/shared-access/state",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
    }
  });

  it("answers the public API like any unknown /api route to an anonymous caller while off: 401", async () => {
    app = await buildApp({ enabled: false });
    const res = await app.inject({ method: "GET", url: "/api/v1/shared-access/public/session" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Authentication required" });
  });

  it("gates a percent-encoded owner path like the plain one", async () => {
    app = await buildApp({ role: "standard" });
    const res = await app.inject({ method: "GET", url: "/api/v1/%73hared-access/state" });
    expect(res.statusCode).toBe(403);
  });

  it("refuses the owner's routes to a non-admin, reads included", async () => {
    app = await buildApp({ role: "standard" });
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/shared-access/state" })).statusCode,
    ).toBe(403);
    const post = await app.inject({
      method: "POST",
      url: "/api/v1/shared-access/accesses",
      payload: { label: "X", gates: [] },
    });
    expect(post.statusCode).toBe(403);
  });

  it("serves the page with its CSP, noindex, no-store and no cookie", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/access/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body).toContain('<script src="app.js"></script>');
    const redirect = await app.inject({ method: "GET", url: "/access" });
    expect(redirect.statusCode).toBe(302);
  });

  it("lets a phone enrol, read its session and open, under both prefixes, with no rate limit", async () => {
    app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/shared-access/accesses",
      payload: { label: "Plombier", gates: [{ equipmentId: h.gates.entree }] },
    });
    expect(created.statusCode).toBe(201);
    const code = created.json<{ code: string }>().code;

    const enrol = await app.inject({ method: "POST", url: "/access/api/enrol", payload: { code } });
    expect(enrol.statusCode).toBe(200);
    const token = enrol.json<{ token: string }>().token;
    const auth = { authorization: `Bearer ${token}` };

    // Well past the 5/min the global limit allows.
    for (let i = 0; i < 8; i++) {
      const s = await app.inject({
        method: "GET",
        url: "/api/v1/shared-access/public/session",
        headers: auth,
      });
      expect(s.statusCode).toBe(200);
    }
    const open = await app.inject({
      method: "POST",
      url: "/access/api/open",
      headers: auth,
      payload: { gate: h.gates.entree },
    });
    expect(open.json()).toEqual({ ok: true });
    expect(h.dispatches).toHaveLength(1);

    const refused = await app.inject({
      method: "POST",
      url: "/access/api/open",
      headers: auth,
      payload: { gate: h.gates.garage },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ ok: false, reason: "not_this_gate" });
  });

  it("gives an enrolled phone its link as a QR code, and lets the owner list and cut phones", async () => {
    app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/shared-access/accesses",
      payload: { label: "Gîte", gates: [{ equipmentId: h.gates.entree }] },
    });
    const { id, code, invitationUrl } = created.json<{
      id: string;
      code: string;
      invitationUrl: string;
    }>();
    const enrol = await app.inject({
      method: "POST",
      url: "/access/api/enrol",
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
      payload: { code },
    });
    const auth = { authorization: `Bearer ${enrol.json<{ token: string }>().token}` };

    const share = await app.inject({ method: "GET", url: "/access/api/share", headers: auth });
    expect(share.statusCode).toBe(200);
    expect(share.headers["cache-control"]).toBe("no-store");
    expect(share.json()).toMatchObject({ url: invitationUrl });
    expect(share.json<{ qr: string }>().qr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/access/api/share",
          headers: { authorization: "Bearer x" },
        })
      ).statusCode,
    ).toBe(401);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/shared-access/accesses/${id}/phones`,
    });
    const phones = list.json<{ phones: { id: string; platform: string }[] }>().phones;
    expect(phones).toHaveLength(1);
    expect(phones[0].platform).toBe("iphone");

    const cut = await app.inject({
      method: "DELETE",
      url: `/api/v1/shared-access/accesses/${id}/phones/${phones[0].id}`,
    });
    expect(cut.statusCode).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: "/access/api/session", headers: auth })).statusCode,
    ).toBe(401);
  });

  it("answers 401 to an unknown phone and to a wrong code", async () => {
    app = await buildApp();
    const s = await app.inject({
      method: "GET",
      url: "/access/api/session",
      headers: { authorization: "Bearer nope" },
    });
    expect(s.statusCode).toBe(401);
    const e = await app.inject({
      method: "POST",
      url: "/access/api/enrol",
      payload: { code: "0000-0000" },
    });
    expect(e.statusCode).toBe(401);
    expect(e.json()).toEqual({ error: "unknown_code" });
  });

  it("maps the manager's refusals to their codes", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shared-access/accesses",
      payload: { label: "X", gates: [{ equipmentId: h.gates.volet }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "unsupported_equipment" });
  });
});

describe("the public surface", () => {
  it("is outside authentication, and only under /public/", () => {
    expect(isPublicRoute("/api/v1/shared-access/public/enrol")).toBe(true);
    expect(isPublicRoute("/api/v1/shared-access/state")).toBe(false);
    expect(isPublicRoute("/api/v1/shared-access/accesses")).toBe(false);
  });

  it("ships a script that parses", () => {
    expect(() => new Function(GUEST_JS)).not.toThrow();
  });
});
