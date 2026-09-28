import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { deflateSync } from "node:zlib";
import { registerSharedAccessRoutes } from "./shared-access.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";
import { isPublicRoute } from "../../auth/auth-middleware.js";
import {
  buildSharedAccessHarness,
  silentLogger,
  type SharedAccessHarness,
} from "../../test-helpers/shared-access.js";
import { pngSize } from "../../shared-access/app-branding.js";
import { GUEST_JS } from "../../shared-access/guest-page.js";
import type { UserRole } from "../../shared/types.js";

// Spec 181 R5.24 — the visitor's page on the home screen: its name, its icons,
// and a manifest whose start URL keeps the phone's token.

let h: SharedAccessHarness;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;

async function buildApp(opts: { enabled?: boolean; role?: UserRole } = {}) {
  h = buildSharedAccessHarness({ enabled: opts.enabled });
  const fastify = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(fastify);
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

function png(size: number): string {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(size, 8);
  ihdr.writeUInt32BE(size, 12);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    deflateSync(Buffer.alloc(10)),
  ]).toString("base64");
}

describe("the shared access page as an app", () => {
  it("serves a default icon at each size, and a manifest with no start URL", async () => {
    app = await buildApp();
    for (const [file, size] of [
      ["apple-touch-icon.png", 180],
      ["icon-192.png", 192],
      ["icon-512.png", 512],
    ] as const) {
      const res = await app.inject({ method: "GET", url: `/access/${file}` });
      expect(res.statusCode, file).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(pngSize(res.rawPayload)).toEqual({ width: size, height: size });
    }
    const manifest = (
      await app.inject({ method: "GET", url: "/access/manifest.webmanifest" })
    ).json();
    expect(manifest).toMatchObject({ id: "./", name: "Accès", scope: "./", display: "standalone" });
    // The start URL defaults to the document's, token fragment included.
    expect(manifest.start_url).toBeUndefined();
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512"]);
  });

  it("links no manifest from the page itself: the script adds it once the token is in the URL", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/access/" });
    expect(res.body).not.toContain('rel="manifest"');
    expect(res.body).toContain('rel="apple-touch-icon"');
    expect(GUEST_JS).toContain('"#t=" + token');
    expect(GUEST_JS).toContain('l.rel = "manifest"');
  });

  it("lets the owner name the app and give it an icon, seen by the page, the manifest and the phones", async () => {
    app = await buildApp();
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/shared-access/app",
      payload: { name: "SOLIO <3", icons: { "180": png(180), "192": png(192), "512": png(512) } },
    });
    expect(put.statusCode).toBe(200);
    const view = put.json<{ name: string; customIcon: boolean; version: string }>();
    expect(view).toMatchObject({ name: "SOLIO <3", customIcon: true });

    const page = await app.inject({ method: "GET", url: "/access/" });
    expect(page.body).toContain("<title>SOLIO &lt;3</title>");
    expect(page.body).toContain(`apple-touch-icon.png?v=${view.version}`);
    const manifest = (
      await app.inject({ method: "GET", url: "/access/manifest.webmanifest" })
    ).json();
    expect(manifest.name).toBe("SOLIO <3");
    const icon = await app.inject({ method: "GET", url: "/access/icon-512.png" });
    expect(icon.rawPayload.toString("base64")).toBe(png(512));

    const get = await app.inject({ method: "GET", url: "/api/v1/shared-access/app" });
    expect(get.json()).toEqual(view);
  });

  it("refuses a bad icon with a 400, and keeps the owner's routes for admins", async () => {
    app = await buildApp();
    const bad = await app.inject({
      method: "PUT",
      url: "/api/v1/shared-access/app",
      payload: { icons: { "180": png(180), "192": png(100), "512": png(512) } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: "invalid_app" });
    await app.close();

    app = await buildApp({ role: "standard" });
    const denied = await app.inject({
      method: "PUT",
      url: "/api/v1/shared-access/app",
      payload: { name: "X" },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("answers the icons and the app routes as unknown while the setting is off", async () => {
    app = await buildApp({ enabled: false });
    for (const url of [
      "/access/icon-192.png",
      "/access/apple-touch-icon.png",
      "/api/v1/shared-access/app",
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(404);
    }
  });
});
