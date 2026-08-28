import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Replicates the static-serving + SPA fallback block in server.ts (the
// `existsSync(uiDir)` branch). If server.ts diverges, this test no longer
// protects against regressions — keep them in sync.
//
// This tier exists because the fallback serves the entire React app and had no
// coverage at all: no test imports createServer, so a @fastify/static major
// could change routing behaviour with every check still green. It is the
// regression guard for that upgrade path.
async function buildAppServingUi(uiDir: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyStatic, {
    root: uiDir,
    prefix: "/",
    wildcard: false,
  });

  app.addHook("onSend", (_req, reply, payload, done) => {
    const url = _req.url;
    if (
      url.endsWith(".webmanifest") ||
      url.endsWith("manifest.json") ||
      url.includes("apple-touch-icon") ||
      url.match(/pwa-.*\.png$/)
    ) {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
    }
    done(null, payload);
  });

  app.setNotFoundHandler((_req, reply) => {
    const pathname = _req.url.split("?")[0];
    if (/\.\w+$/.test(pathname)) {
      void reply.sendFile(pathname.slice(1));
      return;
    }
    void reply.sendFile("index.html");
  });

  await app.ready();
  return app;
}

describe("UI static serving and SPA fallback", () => {
  let tmpDir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sowel-uidist-"));
    mkdirSync(join(tmpDir, "assets"));
    writeFileSync(join(tmpDir, "index.html"), "<!doctype html><title>Sowel</title>");
    writeFileSync(join(tmpDir, "assets", "app.js"), "console.log('bundle');");
    writeFileSync(join(tmpDir, "manifest.webmanifest"), '{"name":"Sowel"}');
    app = await buildAppServingUi(tmpDir);
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves a hashed asset from ui-dist", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("console.log('bundle')");
  });

  it("serves index.html at the root", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<title>Sowel</title>");
  });

  // The fragile one. Every client-side route (/zones/x, /equipments/y) is
  // unknown to Fastify and must fall through to index.html, or the app 404s on
  // a page refresh anywhere but the root.
  it.each(["/zones/kitchen", "/equipments/42", "/settings", "/deeply/nested/route"])(
    "falls back to index.html for the client-side route %s",
    async (url) => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("<title>Sowel</title>");
    },
  );

  it("keeps the fallback working when the route carries a query string", async () => {
    const res = await app.inject({ method: "GET", url: "/zones/kitchen?tab=history" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<title>Sowel</title>");
  });

  // An extensioned path is treated as a file request, not a route, so a missing
  // one must 404 rather than silently serving the HTML shell to something that
  // asked for JavaScript.
  it("404s a missing file rather than serving the SPA shell", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/does-not-exist.js" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("<title>Sowel</title>");
  });

  it("marks the PWA manifest no-store so iOS cannot pin a stale one", async () => {
    const res = await app.inject({ method: "GET", url: "/manifest.webmanifest" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");
  });

  it("does not mark ordinary assets no-store", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(res.headers["cache-control"]).not.toBe("no-cache, no-store, must-revalidate");
  });

  // Escaping ui-dist must fail whatever the encoding. The fallback hands the
  // path to reply.sendFile, so this is the one place a traversal could reach
  // the filesystem.
  it.each([
    "/../package.json",
    "/..%2Fpackage.json",
    "/%2e%2e%2fpackage.json",
    "/assets/../../package.json",
  ])("refuses to escape ui-dist via %s", async (url) => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).not.toBe(200);
    expect(res.body).not.toContain("better-sqlite3");
  });
});
