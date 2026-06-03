import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerSystemRoutes, type TzInfo } from "./system.js";
import type { SunlightManager, SunlightData } from "../../zones/sunlight-manager.js";

const logger = createLogger("silent").logger;

interface BuildOpts {
  authed?: boolean;
  sunlight?: SunlightData;
  shadowMode?: boolean;
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
      request.auth = { userId: "u1", role: "admin" };
    });
  }

  registerSystemRoutes(app, {
    versionChecker: {} as never,
    updateManager: {} as never,
    tzInfo,
    sunlightManager,
    shadowMode: opts.shadowMode ?? false,
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
    expect(res.json()).toEqual({ shadowMode: false });
  });

  it("returns shadowMode=true when the env var is set", async () => {
    openApp = await buildApp({ authed: true, shadowMode: true });
    const res = await openApp.inject({ method: "GET", url: "/api/v1/system/mode" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ shadowMode: true });
  });
});
