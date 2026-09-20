/**
 * Spec 180 — the three surfaces the core lends a plugin.
 *
 * What is worth pinning here is not that a call reaches the plugin, but every
 * place the core stands between the caller and it: the admin gate, the two
 * opt-ins on the anonymous tree, the header allowlists in both directions, the
 * timeout, and the path confinement on the asset tree.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerPluginSurfaceRoutes } from "./plugin-surface.js";
import { publicTreeSettingKey } from "../../shared/constants.js";
import type { PluginHttpRequest, PluginHttpResponse, UserRole } from "../../shared/types.js";

const logger = createLogger("silent").logger;

interface BuildOpts {
  role?: UserRole | null;
  /** What the plugin does with the call it is handed. */
  handlePage?: (req: PluginHttpRequest) => Promise<PluginHttpResponse>;
  handlePublic?: (req: PluginHttpRequest) => Promise<PluginHttpResponse>;
  /** Manifest bits the routes read. */
  ui?: { entry: string; label: string; icon?: string };
  publicTree?: boolean;
  enabled?: boolean;
  installed?: boolean;
  publicEnabled?: boolean;
  pkgDir?: string;
}

let seen: PluginHttpRequest[] = [];
let settings: Record<string, string> = {};
let audit: Array<Record<string, unknown>> = [];
const tempDirs: string[] = [];

function makePluginDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "sowel-plugin-surface-"));
  tempDirs.push(dir);
  mkdirSync(resolve(dir, "ui"), { recursive: true });
  writeFileSync(resolve(dir, "ui", "panel.js"), "export function mount() {}\n");
  writeFileSync(resolve(dir, "ui", "panel.sh"), "#!/bin/sh\n");
  writeFileSync(resolve(dir, "manifest.json"), "{}\n");
  return dir;
}

async function buildApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  seen = [];
  audit = [];
  settings = opts.publicEnabled ? { [publicTreeSettingKey("demo")]: "true" } : {};

  const app = Fastify({ logger: false });
  const role = opts.role === undefined ? "admin" : opts.role;
  if (role !== null) {
    app.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role };
    });
  }

  const manifest = {
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    description: "",
    icon: "Cpu",
    repo: "o/r",
    ...(opts.ui ? { ui: opts.ui } : {}),
    ...(opts.publicTree ? { publicTree: true } : {}),
  };
  const pkg = { manifest, enabled: opts.enabled ?? true, installedAt: "", source: "registry" };

  const plugin = {
    id: "demo",
    ...(opts.handlePage
      ? {
          handlePageRequest: async (req: PluginHttpRequest) => {
            seen.push(req);
            return opts.handlePage!(req);
          },
        }
      : {}),
    ...(opts.handlePublic
      ? {
          handlePublicRequest: async (req: PluginHttpRequest) => {
            seen.push(req);
            return opts.handlePublic!(req);
          },
        }
      : {}),
  };

  registerPluginSurfaceRoutes(app, {
    pluginLoader: {
      getPages: () => [
        { pluginId: "demo", label: "Demo", icon: "Cpu", entryUrl: "/plugin-ui/demo/ui/panel.js" },
      ],
    } as never,
    packageManager: {
      getById: (id: string) => (id === "demo" && (opts.installed ?? true) ? pkg : undefined),
      getPackageDir: (id: string) => {
        if (id !== "demo") throw new Error("Invalid package id");
        return opts.pkgDir ?? "/nonexistent";
      },
    } as never,
    integrationRegistry: {
      getById: (id: string) => (id === "demo" ? plugin : undefined),
    } as never,
    settingsManager: {
      get: (key: string) => settings[key],
      set: (key: string, value: string) => {
        settings[key] = value;
      },
    } as never,
    auditLogger: { log: (entry: Record<string, unknown>) => audit.push(entry) } as never,
    userManager: { getById: () => ({ username: "adrien" }) } as never,
    logger,
  });

  await app.ready();
  return app;
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("plugin pages listing", () => {
  it("is admin-only", async () => {
    const app = await buildApp({ role: "standard" });
    const res = await app.inject({ method: "GET", url: "/api/v1/plugins/pages" });
    expect(res.statusCode).toBe(403);
  });

  it("returns the declared pages", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/plugins/pages" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { pluginId: "demo", label: "Demo", icon: "Cpu", entryUrl: "/plugin-ui/demo/ui/panel.js" },
    ]);
  });
});

describe("the page API", () => {
  it("refuses a standard user before the plugin is reached", async () => {
    const app = await buildApp({ role: "standard", handlePage: async () => ({ body: {} }) });
    const res = await app.inject({ method: "GET", url: "/api/v1/plugins/demo/page/accesses" });
    expect(res.statusCode).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it("404s when the plugin serves no page", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/plugins/demo/page/accesses" });
    expect(res.statusCode).toBe(404);
  });

  it("hands over the path, the query, the body and the acting user", async () => {
    const app = await buildApp({ handlePage: async () => ({ body: { ok: true } }) });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/plugins/demo/page/accesses?view=active",
      payload: { label: "Voisin" },
      headers: { authorization: "Bearer secret-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(seen[0].path).toBe("/accesses");
    expect(seen[0].query).toEqual({ view: "active" });
    expect(seen[0].body).toEqual({ label: "Voisin" });
    expect(seen[0].user).toEqual({ id: "u1", username: "adrien", role: "admin" });
  });

  it("never hands the caller's bearer token to the plugin", async () => {
    const app = await buildApp({ handlePage: async () => ({ body: {} }) });
    await app.inject({
      method: "GET",
      url: "/api/v1/plugins/demo/page/x",
      headers: { authorization: "Bearer secret-token", "user-agent": "vitest" },
    });
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(seen[0].headers["user-agent"]).toBe("vitest");
  });

  it("answers 500 when the plugin threw (spec 111 degraded it to undefined)", async () => {
    const app = await buildApp({
      handlePage: async () => undefined as unknown as PluginHttpResponse,
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/plugins/demo/page/x" });
    expect(res.statusCode).toBe(500);
  });

  it("drops a response header outside the allowlist", async () => {
    const app = await buildApp({
      handlePage: async () => ({
        body: {},
        headers: { "set-cookie": "sid=1", "cache-control": "no-store" },
      }),
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/plugins/demo/page/x" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("answers 504 when the plugin never comes back", async () => {
    const app = await buildApp({ handlePage: () => new Promise(() => {}) });
    vi.useFakeTimers();
    const pending = app.inject({ method: "GET", url: "/api/v1/plugins/demo/page/x" });
    await vi.advanceTimersByTimeAsync(15_001);
    const res = await pending;
    expect(res.statusCode).toBe(504);
  });
});

describe("the page's static assets", () => {
  it("serves a file from the entry's directory", async () => {
    const app = await buildApp({
      pkgDir: makePluginDir(),
      ui: { entry: "ui/panel.js", label: "Demo" },
    });
    const res = await app.inject({ method: "GET", url: "/plugin-ui/demo/panel.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("mount");
  });

  it("refuses an extension outside the allowlist", async () => {
    const app = await buildApp({
      pkgDir: makePluginDir(),
      ui: { entry: "ui/panel.js", label: "Demo" },
    });
    const res = await app.inject({ method: "GET", url: "/plugin-ui/demo/panel.sh" });
    expect(res.statusCode).toBe(404);
  });

  it("refuses to climb out of the ui directory", async () => {
    const app = await buildApp({
      pkgDir: makePluginDir(),
      ui: { entry: "ui/panel.js", label: "Demo" },
    });
    const res = await app.inject({ method: "GET", url: "/plugin-ui/demo/..%2fmanifest.json" });
    expect(res.statusCode).toBe(404);
  });

  it("serves nothing for a plugin that declares no page", async () => {
    const app = await buildApp({ pkgDir: makePluginDir() });
    const res = await app.inject({ method: "GET", url: "/plugin-ui/demo/panel.js" });
    expect(res.statusCode).toBe(404);
  });

  it("serves nothing for a disabled plugin", async () => {
    const app = await buildApp({
      pkgDir: makePluginDir(),
      ui: { entry: "ui/panel.js", label: "Demo" },
      enabled: false,
    });
    const res = await app.inject({ method: "GET", url: "/plugin-ui/demo/panel.js" });
    expect(res.statusCode).toBe(404);
  });
});

describe("the anonymous tree", () => {
  it("is 404 when the manifest does not declare it", async () => {
    const app = await buildApp({ handlePublic: async () => ({ body: "hello" }) });
    const res = await app.inject({ method: "GET", url: "/p/demo/" });
    expect(res.statusCode).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("is 404 while no admin has opened it", async () => {
    const app = await buildApp({
      publicTree: true,
      handlePublic: async () => ({ body: "hello" }),
    });
    const res = await app.inject({ method: "GET", url: "/p/demo/" });
    expect(res.statusCode).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("serves once declared and opened, with no caller named", async () => {
    const app = await buildApp({
      publicTree: true,
      publicEnabled: true,
      handlePublic: async () => ({
        body: "<!doctype html><p>portail</p>",
        contentType: "text/html; charset=utf-8",
      }),
    });
    const res = await app.inject({
      method: "GET",
      url: "/p/demo/?i=4K7M9QT2",
      headers: { authorization: "Bearer device-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(seen[0].path).toBe("/");
    expect(seen[0].query).toEqual({ i: "4K7M9QT2" });
    expect(seen[0].user).toBeUndefined();
    // The only surface where `authorization` is the plugin's own token.
    expect(seen[0].headers.authorization).toBe("Bearer device-token");
  });

  it("serves the bare root as well as a sub-path", async () => {
    const app = await buildApp({
      publicTree: true,
      publicEnabled: true,
      handlePublic: async (req) => ({ body: { path: req.path } }),
    });
    const bare = await app.inject({ method: "GET", url: "/p/demo" });
    expect(bare.json()).toEqual({ path: "/" });
    const sub = await app.inject({ method: "POST", url: "/p/demo/open", payload: { id: "a" } });
    expect(sub.json()).toEqual({ path: "/open" });
  });

  it("is 404 for a plugin that is not installed", async () => {
    const app = await buildApp({
      publicTree: true,
      publicEnabled: true,
      installed: false,
      handlePublic: async () => ({ body: "hello" }),
    });
    const res = await app.inject({ method: "GET", url: "/p/demo/" });
    expect(res.statusCode).toBe(404);
  });
});

describe("opening the anonymous tree", () => {
  it("refuses a plugin that declares none", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/plugins/demo/public",
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(400);
    expect(settings[publicTreeSettingKey("demo")]).toBeUndefined();
  });

  it("writes the setting and audits the act", async () => {
    const app = await buildApp({ publicTree: true });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/plugins/demo/public",
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(settings[publicTreeSettingKey("demo")]).toBe("true");
    expect(audit[0]).toMatchObject({ action: "plugin.public.enable", targetId: "demo" });
  });

  it("shuts it again", async () => {
    const app = await buildApp({ publicTree: true, publicEnabled: true });
    await app.inject({
      method: "PUT",
      url: "/api/v1/plugins/demo/public",
      payload: { enabled: false },
    });
    expect(settings[publicTreeSettingKey("demo")]).toBe("false");
    expect(audit[0]).toMatchObject({ action: "plugin.public.disable" });
  });

  it("is admin-only", async () => {
    const app = await buildApp({ publicTree: true, role: "standard" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/plugins/demo/public",
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });
});
