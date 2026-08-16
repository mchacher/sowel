import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../core/logger.js";
import {
  PUBLIC_ROUTES,
  isPublicRoute,
  registerAuthMiddleware,
  isStandardWriteAllowed,
  isMutationDeniedForStandard,
} from "./auth-middleware.js";
import type { AuthService, JwtPayload } from "./auth-service.js";
import type { UserManager } from "./user-manager.js";

const logger = createLogger("silent").logger;

describe("auth-middleware", () => {
  describe("PUBLIC_ROUTES", () => {
    it("contains the 6 expected public routes", () => {
      expect(PUBLIC_ROUTES.has("/api/v1/health")).toBe(true);
      expect(PUBLIC_ROUTES.has("/api/v1/auth/status")).toBe(true);
      expect(PUBLIC_ROUTES.has("/api/v1/auth/setup")).toBe(true);
      expect(PUBLIC_ROUTES.has("/api/v1/auth/login")).toBe(true);
      expect(PUBLIC_ROUTES.has("/api/v1/auth/refresh")).toBe(true);
      // Spec 151 — authenticated via mfaToken in the body, not a bearer token.
      expect(PUBLIC_ROUTES.has("/api/v1/auth/mfa/verify")).toBe(true);
      expect(PUBLIC_ROUTES.size).toBe(6);
    });

    it("does NOT include sensitive routes that were previously unprotected", () => {
      expect(PUBLIC_ROUTES.has("/api/v1/devices/suggest")).toBe(false);
      expect(PUBLIC_ROUTES.has("/api/v1/settings")).toBe(false);
      expect(PUBLIC_ROUTES.has("/api/v1/system/update")).toBe(false);
      expect(PUBLIC_ROUTES.has("/api/v1/backup")).toBe(false);
    });
  });

  describe("isPublicRoute", () => {
    it("returns true for every PUBLIC_ROUTES entry", () => {
      for (const route of PUBLIC_ROUTES) {
        expect(isPublicRoute(route)).toBe(true);
      }
    });

    it("strips query string before checking", () => {
      expect(isPublicRoute("/api/v1/health?check=full")).toBe(true);
      expect(isPublicRoute("/api/v1/auth/login?ts=1234")).toBe(true);
    });

    it("returns false for sensitive routes", () => {
      expect(isPublicRoute("/api/v1/devices/suggest")).toBe(false);
      expect(isPublicRoute("/api/v1/devices/suggest?type=gate")).toBe(false);
      expect(isPublicRoute("/api/v1/settings")).toBe(false);
      expect(isPublicRoute("/api/v1/system/update")).toBe(false);
    });

    it("allows OAuth callback routes (external providers cannot send a bearer)", () => {
      expect(isPublicRoute("/api/v1/plugins/panasonic_cc/oauth/callback")).toBe(true);
      expect(isPublicRoute("/api/v1/plugins/smartthings/oauth/callback")).toBe(true);
      expect(isPublicRoute("/api/v1/plugins/smartthings/oauth/callback?code=abc")).toBe(true);
    });

    it("rejects malformed OAuth-looking paths", () => {
      expect(isPublicRoute("/api/v1/plugins/oauth/callback")).toBe(false);
      expect(isPublicRoute("/api/v1/plugins/foo/bar/oauth/callback")).toBe(false);
      expect(isPublicRoute("/api/v1/plugins/foo/oauth/callback/extra")).toBe(false);
    });
  });

  describe("registerAuthMiddleware — request enforcement", () => {
    let app: ReturnType<typeof Fastify>;
    let mockUserManager: UserManager;
    let mockAuthService: AuthService;
    const validPayload: JwtPayload = { userId: "user-1", role: "admin" };

    beforeEach(async () => {
      mockUserManager = {
        hasUsers: vi.fn().mockReturnValue(true),
      } as unknown as UserManager;
      mockAuthService = {
        verifyAccessToken: vi.fn().mockReturnValue(validPayload),
        verifyApiToken: vi.fn().mockReturnValue(validPayload),
      } as unknown as AuthService;

      app = Fastify({ logger: false });
      registerAuthMiddleware(app, {
        authService: mockAuthService,
        userManager: mockUserManager,
        logger,
      });
      // Fake protected route
      app.get("/api/v1/test", async (req) => ({ auth: req.auth }));
      app.get("/api/v1/health", async () => ({ status: "ok" }));
      app.post("/api/v1/auth/setup", async () => ({ ok: true }));
      app.get("/non-api/foo", async () => ({ ok: true }));
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it("rejects unauthenticated GET on protected route with 401", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/test" });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Authentication required" });
    });

    it("allows unauthenticated GET on public route", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/health" });
      expect(res.statusCode).toBe(200);
    });

    it("ignores non-/api routes (static UI fallback)", async () => {
      const res = await app.inject({ method: "GET", url: "/non-api/foo" });
      expect(res.statusCode).toBe(200);
    });

    it("rejects invalid bearer token with 401", async () => {
      vi.mocked(mockAuthService.verifyAccessToken).mockImplementation(() => {
        throw new Error("Invalid");
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test",
        headers: { authorization: "Bearer not-a-real-token" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects invalid API token (swl_) with 401", async () => {
      vi.mocked(mockAuthService.verifyApiToken).mockReturnValue(null);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test",
        headers: { authorization: "Bearer swl_deadbeef" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("accepts valid JWT and populates request.auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test",
        headers: { authorization: "Bearer header.payload.signature" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().auth).toEqual(validPayload);
      expect(mockAuthService.verifyAccessToken).toHaveBeenCalledWith("header.payload.signature");
    });

    it("accepts valid API token (swl_)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test",
        headers: { authorization: "Bearer swl_abc123" },
      });
      expect(res.statusCode).toBe(200);
      expect(mockAuthService.verifyApiToken).toHaveBeenCalledWith("swl_abc123");
    });

    it("accepts legacy API token prefixes (wch_, cbl_)", async () => {
      const wchRes = await app.inject({
        method: "GET",
        url: "/api/v1/test",
        headers: { authorization: "Bearer wch_legacy" },
      });
      expect(wchRes.statusCode).toBe(200);

      const cblRes = await app.inject({
        method: "GET",
        url: "/api/v1/test",
        headers: { authorization: "Bearer cbl_legacy" },
      });
      expect(cblRes.statusCode).toBe(200);
    });

    it("rejects malformed Authorization header (missing Bearer prefix)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test",
        headers: { authorization: "swl_no-bearer-prefix" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("setup mode (no users): returns 403 setupRequired on non-setup routes", async () => {
      vi.mocked(mockUserManager.hasUsers).mockReturnValue(false);
      const res = await app.inject({ method: "GET", url: "/api/v1/test" });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "Setup required", setupRequired: true });
    });

    it("setup mode (no users): /api/v1/auth/setup passes through", async () => {
      vi.mocked(mockUserManager.hasUsers).mockReturnValue(false);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/setup",
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("isStandardWriteAllowed / isMutationDeniedForStandard (spec 131)", () => {
    it("allows the usage + personal write allowlist", () => {
      expect(isStandardWriteAllowed("POST", "/api/v1/equipments/abc/orders/state")).toBe(true);
      expect(isStandardWriteAllowed("POST", "/api/v1/zones/z1/orders/allLightsOff")).toBe(true);
      expect(isStandardWriteAllowed("PUT", "/api/v1/me")).toBe(true);
      expect(isStandardWriteAllowed("PUT", "/api/v1/me/preferences")).toBe(true);
      expect(isStandardWriteAllowed("PUT", "/api/v1/me/password")).toBe(true);
      expect(isStandardWriteAllowed("POST", "/api/v1/me/tokens")).toBe(true);
      expect(isStandardWriteAllowed("DELETE", "/api/v1/me/tokens/tok-1")).toBe(true);
      expect(isStandardWriteAllowed("POST", "/api/v1/push/subscriptions")).toBe(true);
      expect(isStandardWriteAllowed("DELETE", "/api/v1/push/subscriptions")).toBe(true);
      expect(isStandardWriteAllowed("POST", "/api/v1/auth/logout")).toBe(true);
    });

    it("denies config mutations, including near-misses of the orders rule", () => {
      expect(isStandardWriteAllowed("POST", "/api/v1/equipments")).toBe(false);
      expect(isStandardWriteAllowed("PUT", "/api/v1/equipments/abc")).toBe(false);
      expect(isStandardWriteAllowed("DELETE", "/api/v1/equipments/abc")).toBe(false);
      expect(isStandardWriteAllowed("POST", "/api/v1/equipments/abc/order-bindings")).toBe(false);
      expect(isStandardWriteAllowed("POST", "/api/v1/modes/m1/activate")).toBe(false);
      expect(isStandardWriteAllowed("POST", "/api/v1/recipe-instances/r1/enable")).toBe(false);
      expect(isStandardWriteAllowed("POST", "/api/v1/dashboard/widgets")).toBe(false);
      expect(isStandardWriteAllowed("PUT", "/api/v1/settings")).toBe(false);
      expect(isStandardWriteAllowed("PUT", "/api/v1/devices/d1")).toBe(false);
    });

    it("a wrong method on an allowed path is not allowed", () => {
      expect(isStandardWriteAllowed("DELETE", "/api/v1/equipments/abc/orders/state")).toBe(false);
      expect(isStandardWriteAllowed("POST", "/api/v1/me")).toBe(false);
    });

    it("isMutationDeniedForStandard: admin and GET are never denied", () => {
      expect(isMutationDeniedForStandard("POST", "/api/v1/equipments", "admin")).toBe(false);
      expect(isMutationDeniedForStandard("DELETE", "/api/v1/zones/z1", "admin")).toBe(false);
      expect(isMutationDeniedForStandard("GET", "/api/v1/equipments", "standard")).toBe(false);
    });

    it("isMutationDeniedForStandard: standard denied on config, allowed on usage", () => {
      expect(isMutationDeniedForStandard("POST", "/api/v1/equipments", "standard")).toBe(true);
      expect(isMutationDeniedForStandard("POST", "/api/v1/modes/m/activate", "standard")).toBe(
        true,
      );
      expect(
        isMutationDeniedForStandard("POST", "/api/v1/equipments/x/orders/state", "standard"),
      ).toBe(false);
      expect(isMutationDeniedForStandard("PUT", "/api/v1/me/password", "standard")).toBe(false);
    });
  });

  describe("role gate — request enforcement (spec 131)", () => {
    let app: ReturnType<typeof Fastify>;
    let role: "admin" | "standard";

    beforeEach(async () => {
      role = "standard";
      const userManager = { hasUsers: () => true } as unknown as UserManager;
      const authService = {
        verifyAccessToken: () => ({ userId: "u1", role }),
        verifyApiToken: () => ({ userId: "u1", role }),
      } as unknown as AuthService;
      app = Fastify({ logger: false });
      registerAuthMiddleware(app, { authService, userManager, logger });
      app.get("/api/v1/equipments", async () => ({ ok: true }));
      app.post("/api/v1/equipments", async () => ({ ok: true }));
      app.post("/api/v1/equipments/:id/orders/:alias", async () => ({ ok: true }));
      app.delete("/api/v1/zones/:id", async () => ({ ok: true }));
      app.post("/api/v1/modes/:id/activate", async () => ({ ok: true }));
      app.put("/api/v1/me/password", async () => ({ ok: true }));
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    const auth = { authorization: "Bearer header.payload.sig" };

    it("standard: reads pass", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/equipments", headers: auth });
      expect(res.statusCode).toBe(200);
    });

    it("standard: config mutations are 403", async () => {
      expect(
        (await app.inject({ method: "POST", url: "/api/v1/equipments", headers: auth })).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: "DELETE", url: "/api/v1/zones/z1", headers: auth })).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: "POST", url: "/api/v1/modes/m/activate", headers: auth }))
          .statusCode,
      ).toBe(403);
    });

    it("standard: allowlisted usage mutations pass, even with a query string", async () => {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/equipments/e1/orders/state",
            headers: auth,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/equipments/e1/orders/state?foo=1",
            headers: auth,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: "PUT", url: "/api/v1/me/password", headers: auth })).statusCode,
      ).toBe(200);
    });

    it("admin: every mutation passes", async () => {
      role = "admin";
      expect(
        (await app.inject({ method: "POST", url: "/api/v1/equipments", headers: auth })).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: "DELETE", url: "/api/v1/zones/z1", headers: auth })).statusCode,
      ).toBe(200);
    });

    it("standard-scoped API token: config 403, usage 200 (no escalation)", async () => {
      const tok = { authorization: "Bearer swl_standardtoken" };
      expect(
        (await app.inject({ method: "POST", url: "/api/v1/equipments", headers: tok })).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/equipments/e1/orders/state",
            headers: tok,
          })
        ).statusCode,
      ).toBe(200);
    });
  });
});
