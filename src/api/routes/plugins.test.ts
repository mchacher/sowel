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
  /** Repos known as personal sources, which routes install through PackageManager. */
  personalSources?: string[];
  addSource?: (repo: string) => Promise<unknown>;
  removeSource?: (repo: string) => void;
}

/** What each stub was asked to do, so a test can prove the handler ran. */
let calls: Array<[string, ...unknown[]]> = [];

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
    sources: new Map((opts.personalSources ?? []).map((r) => [r, {}])),
    listPersonalSources: () => [],
    installFromGitHub: async (repo: string, o?: unknown) => {
      calls.push(["installFromGitHub", repo, o]);
      return { id: "x", version: "1.0.0", type: "integration" };
    },
  };

  registerPluginRoutes(app, {
    packageManager,
    pluginLoader: {
      loadNewlyInstalled: async () => {},
      install: async (repo: string, o?: unknown) => {
        calls.push(["pluginLoader.install", repo, o]);
        return { id: "x", version: "1.0.0" };
      },
      update: async (id: string, o?: unknown) => {
        calls.push(["pluginLoader.update", id, o]);
        return { id, version: "1.0.1" };
      },
    },
    recipeLoader: {
      loadNewlyInstalled: async () => {},
      install: async (repo: string) => {
        calls.push(["recipeLoader.install", repo]);
      },
      update: async (id: string, o?: unknown) => {
        calls.push(["recipeLoader.update", id, o]);
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

  it("hands `confirmed` to the loader on the registry path", async () => {
    // Asserting the status alone let the whole spec 089 / spec 136
    // confirmation plumbing be torn out with the suite still green (#597
    // review). What the loader RECEIVES is the contract.
    //
    // Note the registry path forwards `confirmed` only: the TOFU hash belongs
    // to the personal-source path below, and pinning that here would have
    // asserted something the route never does.
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: INSTALL,
      payload: { repo: "me/plug", confirmed: true, expectedSha256: "a".repeat(64) },
    });
    expect(res.statusCode).toBeLessThan(400);
    expect(calls).toContainEqual(["pluginLoader.install", "me/plug", { confirmed: true }]);
  });

  it("hands both confirmation fields through on the personal-source path", async () => {
    // Spec 136 TOFU: the approved hash must reach PackageManager, or the
    // re-downloaded tarball is never checked against what the admin approved.
    app = await buildApp({ personalSources: ["me/plug"] });
    const sha = "a".repeat(64);
    const res = await app.inject({
      method: "POST",
      url: INSTALL,
      payload: { repo: "me/plug", confirmed: true, expectedSha256: sha },
    });
    expect(res.statusCode).toBeLessThan(400);
    expect(calls).toContainEqual([
      "installFromGitHub",
      "me/plug",
      { confirmed: true, expectedSha256: sha },
    ]);
  });

  it("still accepts an explicit null for either optional field", async () => {
    // The hand-rolled version handed both straight on, so `null` reached the
    // loader as "absent". A client that always emits a null hash when it has
    // none is idiomatic and must keep working.
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: INSTALL,
      payload: { repo: "me/plug", confirmed: null, expectedSha256: null },
    });
    expect(res.statusCode).toBeLessThan(400);
  });

  it("400s a wrongly typed confirmation field (tightening, #597)", async () => {
    // `confirmed: "true"` used to install as though confirmed, because the
    // loader only reads it for truthiness. A client bug that silently defeated
    // the spec 089 confirmation step.
    app = await buildApp();
    for (const payload of [
      { repo: "me/plug", confirmed: "true" },
      { repo: "me/plug", confirmed: 1 },
      { repo: "me/plug", expectedSha256: 42 },
    ]) {
      const res = await app.inject({ method: "POST", url: INSTALL, payload });
      expect(res.statusCode).toBe(400);
      expect(calls).toEqual([]);
    }
  });

  it("requires the owner/repo shape (tightening, #597)", async () => {
    // The first draft did not, on the reasoning that install looks the value
    // up in the store. That reasoning was wrong on the point that matters:
    // `repo` is interpolated into `api.github.com/repos/${repo}/...` and joined
    // onto the plugin directory with resolve(), so its shape is a security
    // boundary. CodeQL flags the flow, and it is right to.
    app = await buildApp();
    for (const repo of ["anything", "../../etc/passwd", "a/b/c", "evil.com/x/../y"]) {
      const res = await app.inject({ method: "POST", url: INSTALL, payload: { repo } });
      expect(res.statusCode).toBe(400);
      expect(calls).toEqual([]);
    }
    // The shape every legitimate caller already sends still works.
    const ok = await app.inject({ method: "POST", url: INSTALL, payload: { repo: "me/plug" } });
    expect(ok.statusCode).toBeLessThan(400);
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

  it("accepts an empty body, and hands the confirmation fields to the loader", async () => {
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
    expect(calls).toContainEqual([
      "pluginLoader.update",
      "pluginid",
      { confirmed: true, expectedSha256: "b".repeat(64) },
    ]);
  });

  it("still accepts an explicit null for either optional field", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: UPDATE,
      payload: { confirmed: null, expectedSha256: null },
    });
    expect(res.statusCode).toBeLessThan(400);
  });

  it("400s a body that is not an object (tightening, #597)", async () => {
    // `request.body ?? {}` destructured a string or an array into undefined
    // fields and updated anyway, so a client sending nonsense got a 200 and
    // an unconfirmed update.
    app = await buildApp();
    // Sent as raw JSON with an explicit content type: `inject`'s `payload`
    // shortcut would send a bare string as text/plain, which Fastify refuses
    // with 415 before validation ever runs.
    for (const body of ["[]", '[{"confirmed":true}]', '"str"', "5", "true"]) {
      const res = await app.inject({
        method: "POST",
        url: UPDATE,
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("400s a wrongly typed confirmation field (tightening, #597)", async () => {
    app = await buildApp();
    for (const payload of [{ confirmed: "true" }, { confirmed: 1 }, { expectedSha256: 42 }]) {
      const res = await app.inject({ method: "POST", url: UPDATE, payload });
      expect(res.statusCode).toBe(400);
      expect(calls).toEqual([]);
    }
  });

  it("403s a non-admin", async () => {
    app = await buildApp({ role: "standard" });
    const res = await app.inject({ method: "POST", url: UPDATE });
    expect(res.statusCode).toBe(403);
  });
});
