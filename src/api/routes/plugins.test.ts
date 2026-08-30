/**
 * Characterization tests for the plugin routes that carry a body (#597,
 * #482 Lot C).
 *
 * Written BEFORE the schema conversion and run green against the hand-rolled
 * checks first: this file is a 539-line route with a community-owner
 * confirmation flow, so "zero behavioural regression" needs writing down
 * rather than asserting.
 *
 * Only the four body-carrying routes are exercised. The install and update
 * success paths reach deep into PackageManager and both loaders; what matters
 * here is the validation boundary and the order of the answers.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerPluginRoutes } from "./plugins.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";
import type { UserRole } from "../../shared/types.js";

const logger = createLogger("silent").logger;

interface BuildOpts {
  role?: UserRole | null;
  addSource?: (repo: string) => Promise<unknown>;
  removeSource?: (repo: string) => void;
}

/** What each stub was asked to do, so a test can prove the handler ran. */
let calls: Array<[string, unknown]> = [];

async function buildApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  calls = [];
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  const role = opts.role === undefined ? "admin" : opts.role;
  if (role !== null) {
    app.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role };
    });
  }

  const packageManager = {
    addPersonalSource: async (repo: string) => {
      calls.push(["addPersonalSource", repo]);
      return opts.addSource ? await opts.addSource(repo) : { repo, latestVersion: "1.0.0" };
    },
    removePersonalSource: (repo: string) => {
      calls.push(["removePersonalSource", repo]);
      opts.removeSource?.(repo);
    },
    getStore: () => [],
    getById: () => undefined,
    getCurrentVersion: () => "1.63.0",
    sources: new Map(),
    listPersonalSources: () => [],
    installFromGitHub: async (repo: string) => {
      calls.push(["installFromGitHub", repo]);
      return { id: "x", version: "1.0.0", type: "integration" };
    },
  };

  registerPluginRoutes(app, {
    packageManager,
    pluginLoader: {
      loadNewlyInstalled: async () => {},
      install: async (repo: string) => {
        calls.push(["pluginLoader.install", repo]);
        return { id: "x", version: "1.0.0" };
      },
      update: async (id: string) => {
        calls.push(["pluginLoader.update", id]);
        return { id, version: "1.0.1" };
      },
    },
    recipeLoader: {
      loadNewlyInstalled: async () => {},
      install: async (repo: string) => {
        calls.push(["recipeLoader.install", repo]);
      },
      update: async (id: string) => {
        calls.push(["recipeLoader.update", id]);
      },
    },
    integrationRegistry: { getById: () => undefined },
    auditLogger: { log: () => {} },
    userManager: { getById: () => ({ username: "admin" }) },
    logger,
  } as unknown as Parameters<typeof registerPluginRoutes>[1]);
  await app.ready();
  return app;
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const SOURCES = "/api/v1/plugins/sources";
const REMOVE = "/api/v1/plugins/sources/remove";
const INSTALL = "/api/v1/plugins/install";
const UPDATE = "/api/v1/plugins/pluginid/update";

/** The `{ error }` 400 shape #482 preserves, not Fastify's own envelope. */
function expectAppErrorShape(body: unknown): void {
  const b = body as Record<string, unknown>;
  expect(typeof b.error).toBe("string");
  expect(b.statusCode).toBeUndefined();
  expect(b.code).toBeUndefined();
}

describe("POST /api/v1/plugins/sources", () => {
  it("accepts a well-formed owner/repo", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: SOURCES, payload: { repo: "me/plug" } });
    expect(res.statusCode).toBe(201);
    expect(calls).toContainEqual(["addPersonalSource", "me/plug"]);
  });

  it("trims surrounding whitespace before validating and storing", async () => {
    // The `.trim()` is coercion no schema performs, so it stays in the
    // handler: dropping it would turn a paste with a trailing newline from
    // working into a 400.
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: SOURCES,
      payload: { repo: "  me/plug\n" },
    });
    expect(res.statusCode).toBe(201);
    expect(calls).toContainEqual(["addPersonalSource", "me/plug"]);
  });

  const rejects: [string, unknown][] = [
    ["no body", undefined],
    ["missing repo", {}],
    ["empty repo", { repo: "" }],
    ["whitespace-only repo", { repo: "   " }],
    ["repo without a slash", { repo: "notarepo" }],
    ["repo with too many segments", { repo: "a/b/c" }],
  ];
  for (const [name, payload] of rejects) {
    it(`400s on ${name}`, async () => {
      app = await buildApp();
      const res = await app.inject({ method: "POST", url: SOURCES, payload: payload as never });
      expect(res.statusCode).toBe(400);
      expectAppErrorShape(res.json());
      expect(calls).toEqual([]);
    });
  }

  it("400s a non-string repo, which used to be a 500 (#597)", async () => {
    // `(request.body?.repo ?? "").trim()` throws on a number, so a malformed
    // body crashed the handler instead of being refused. The schema settles
    // the type before the trim ever runs.
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: SOURCES, payload: { repo: 42 } });
    expect(res.statusCode).toBe(400);
    expectAppErrorShape(res.json());
    expect(calls).toEqual([]);
  });

  it("403s a non-admin, before looking at the body", async () => {
    app = await buildApp({ role: "standard" });
    const res = await app.inject({ method: "POST", url: SOURCES, payload: { repo: 42 } });
    expect(res.statusCode).toBe(403);
  });

  it("403s a request with no identity at all", async () => {
    app = await buildApp({ role: null });
    const res = await app.inject({ method: "POST", url: SOURCES, payload: { repo: "me/plug" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/v1/plugins/sources/remove", () => {
  it("accepts and trims", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: REMOVE, payload: { repo: " me/plug " } });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(["removePersonalSource", "me/plug"]);
  });

  it("does NOT require owner/repo shape, unlike the add route", async () => {
    // Deliberate asymmetry in the original: removal only checks non-empty, so
    // a source stored under an odd key can still be removed.
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: REMOVE, payload: { repo: "whatever" } });
    expect(res.statusCode).toBe(200);
  });

  for (const [name, payload] of [
    ["no body", undefined],
    ["missing repo", {}],
    ["empty repo", { repo: "" }],
    ["whitespace-only repo", { repo: "  " }],
  ] as [string, unknown][]) {
    it(`400s on ${name}`, async () => {
      app = await buildApp();
      const res = await app.inject({ method: "POST", url: REMOVE, payload: payload as never });
      expect(res.statusCode).toBe(400);
      expectAppErrorShape(res.json());
      expect(calls).toEqual([]);
    });
  }

  it("403s a non-admin before the body", async () => {
    app = await buildApp({ role: "standard" });
    const res = await app.inject({ method: "POST", url: REMOVE, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/v1/plugins/install", () => {
  it("accepts repo alone", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: INSTALL, payload: { repo: "me/plug" } });
    expect(res.statusCode).toBeLessThan(400);
  });

  it("accepts the confirmation fields", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: INSTALL,
      payload: { repo: "me/plug", confirmed: true, expectedSha256: "a".repeat(64) },
    });
    expect(res.statusCode).toBeLessThan(400);
  });

  it("does NOT require owner/repo shape here", async () => {
    // install looks the repo up in the store; the shape check belongs to the
    // personal-source route that has to build a GitHub URL from it.
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: INSTALL, payload: { repo: "anything" } });
    expect(res.statusCode).toBeLessThan(400);
  });

  for (const [name, payload] of [
    ["no body", undefined],
    ["missing repo", { confirmed: true }],
    ["empty repo", { repo: "" }],
    ["repo that is not a string", { repo: 42 }],
  ] as [string, unknown][]) {
    it(`400s on ${name}`, async () => {
      app = await buildApp();
      const res = await app.inject({ method: "POST", url: INSTALL, payload: payload as never });
      expect(res.statusCode).toBe(400);
      expectAppErrorShape(res.json());
    });
  }

  it("403s a non-admin before the body", async () => {
    app = await buildApp({ role: "standard" });
    const res = await app.inject({ method: "POST", url: INSTALL, payload: { repo: 42 } });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/v1/plugins/:id/update", () => {
  it("accepts no body at all", async () => {
    // The body is optional here and a bare update is the normal call.
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: UPDATE });
    expect(res.statusCode).toBeLessThan(400);
  });

  it("accepts an empty body and the confirmation fields", async () => {
    app = await buildApp();
    expect(
      (await app.inject({ method: "POST", url: UPDATE, payload: {} })).statusCode,
    ).toBeLessThan(400);
    const res = await app.inject({
      method: "POST",
      url: UPDATE,
      payload: { confirmed: true, expectedSha256: "b".repeat(64) },
    });
    expect(res.statusCode).toBeLessThan(400);
  });

  it("403s a non-admin", async () => {
    app = await buildApp({ role: "standard" });
    const res = await app.inject({ method: "POST", url: UPDATE });
    expect(res.statusCode).toBe(403);
  });
});
