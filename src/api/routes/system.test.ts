import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerSystemRoutes, type TzInfo } from "./system.js";
import type { SunlightManager, SunlightData } from "../../zones/sunlight-manager.js";

const logger = createLogger("silent").logger;

interface BuildOpts {
  authed?: boolean;
  role?: "admin" | "user" | "viewer";
  sunlight?: SunlightData;
  shadowMode?: boolean;
  takeoverPending?: boolean;
  confirmTakeover?: () => void;
  requestRestart?: () => void;
}

async function buildApp(opts: BuildOpts = {}) {
  const tzInfo: TzInfo = { tz: "Europe/Paris", source: "env", offsetHours: 2 };
  const sunlight: SunlightData = opts.sunlight ?? {
    sunrise: "06:12",
    sunset: "21:31",
    isDaylight: true,
  };
  const sunlightManager = {
    getSunlightData: () => sunlight,
  } as unknown as SunlightManager;

  const app = Fastify({ logger: false });

  if (opts.authed) {
    app.addHook("preHandler", async (request) => {
      request.auth = { userId: "u1", role: opts.role ?? "admin" };
    });
  }

  registerSystemRoutes(app, {
    versionChecker: {} as never,
    updateManager: {} as never,
    tzInfo,
    sunlightManager,
    shadowMode: opts.shadowMode ?? false,
    takeoverPending: opts.takeoverPending ?? false,
    confirmTakeover: opts.confirmTakeover ?? (() => {}),
    requestRestart: opts.requestRestart ?? (() => {}),
    logger,
  });
  await app.ready();
  return app;
}

describe("GET /api/v1/system/sunlight", () => {
  let openApp: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    if (openApp) await openApp.close();
    openApp = null;
  });

  it("rejects unauthenticated callers with 401", async () => {
    openApp = await buildApp({ authed: false });
    const res = await openApp.inject({ method: "GET", url: "/api/v1/system/sunlight" });
    expect(res.statusCode).toBe(401);
  });

  it("returns now + tz + sunlight snapshot to any authenticated user", async () => {
    openApp = await buildApp({
      authed: true,
      sunlight: { sunrise: "06:12", sunset: "21:31", isDaylight: true },
    });
    const res = await openApp.inject({ method: "GET", url: "/api/v1/system/sunlight" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tz).toBe("Europe/Paris");
    expect(body.offsetHours).toBe(2);
    expect(body.sunrise).toBe("06:12");
    expect(body.sunset).toBe("21:31");
    expect(body.isDaylight).toBe(true);
    expect(typeof body.now).toBe("string");
    expect(() => new Date(body.now).toISOString()).not.toThrow();
  });

  it("forwards null sunlight values before the first compute", async () => {
    openApp = await buildApp({
      authed: true,
      sunlight: { sunrise: null, sunset: null, isDaylight: null },
    });
    const res = await openApp.inject({ method: "GET", url: "/api/v1/system/sunlight" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sunrise).toBeNull();
    expect(body.sunset).toBeNull();
    expect(body.isDaylight).toBeNull();
  });
});

// Spec 124 — surfaces the shadowMode flag to authenticated UI clients.
describe("GET /api/v1/system/mode", () => {
  let openApp: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    if (openApp) await openApp.close();
    openApp = null;
  });

  it("rejects unauthenticated callers with 401", async () => {
    openApp = await buildApp({ authed: false });
    const res = await openApp.inject({ method: "GET", url: "/api/v1/system/mode" });
    expect(res.statusCode).toBe(401);
  });

  it("returns shadowMode=false when the env var is not set", async () => {
    openApp = await buildApp({ authed: true, shadowMode: false });
    const res = await openApp.inject({ method: "GET", url: "/api/v1/system/mode" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ shadowMode: false, takeoverPending: false });
  });

  it("returns shadowMode=true when the env var is set", async () => {
    openApp = await buildApp({ authed: true, shadowMode: true });
    const res = await openApp.inject({ method: "GET", url: "/api/v1/system/mode" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ shadowMode: true, takeoverPending: false });
  });

  it("surfaces takeoverPending (issue #401)", async () => {
    openApp = await buildApp({ authed: true, shadowMode: true, takeoverPending: true });
    const res = await openApp.inject({ method: "GET", url: "/api/v1/system/mode" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ shadowMode: true, takeoverPending: true });
  });
});

// Issue #401 — adopt a restored database and restart.
describe("POST /api/v1/system/takeover", () => {
  let openApp: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    if (openApp) await openApp.close();
    openApp = null;
  });

  it("rejects non-admin callers with 403", async () => {
    openApp = await buildApp({ authed: true, role: "user", takeoverPending: true });
    const res = await openApp.inject({ method: "POST", url: "/api/v1/system/takeover" });
    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when no takeover is pending", async () => {
    openApp = await buildApp({ authed: true, takeoverPending: false });
    const res = await openApp.inject({ method: "POST", url: "/api/v1/system/takeover" });
    expect(res.statusCode).toBe(409);
  });

  it("confirms the takeover and requests a restart", async () => {
    const calls: string[] = [];
    openApp = await buildApp({
      authed: true,
      takeoverPending: true,
      confirmTakeover: () => calls.push("confirm"),
      requestRestart: () => calls.push("restart"),
    });
    const res = await openApp.inject({ method: "POST", url: "/api/v1/system/takeover" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, restarting: true });
    expect(calls).toEqual(["confirm", "restart"]);
  });
});
