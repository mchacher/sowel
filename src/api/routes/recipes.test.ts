import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerRecipeRoutes } from "./recipes.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452): pin the accept/reject matrix
// and { error } 400 shape of the recipe-instance route checks so the schema
// move is provably regression-free.

function makeDeps() {
  const instance = { id: "ri-1", recipeId: "r-1", params: {} };
  return {
    recipeManager: {
      createInstance: () => instance,
      updateInstance: () => instance,
      sendAction: () => undefined,
    },
    logger: createLogger("silent").logger,
  } as unknown as Parameters<typeof registerRecipeRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  registerRecipeRoutes(app, makeDeps());
  return app;
}

describe("recipe-instance routes — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const post = (url: string, body: unknown) => app.inject({ method: "POST", url, payload: body });
  const put = (url: string, body: unknown) => app.inject({ method: "PUT", url, payload: body });

  // POST /api/v1/recipe-instances — old: `!recipeId`, `!params || typeof !== object`
  it("400 { error } when recipeId is missing (old `!recipeId`)", async () => {
    const res = await post("/api/v1/recipe-instances", { params: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("400 when params is missing or null (old `!params || typeof !== object`)", async () => {
    expect((await post("/api/v1/recipe-instances", { recipeId: "r-1" })).statusCode).toBe(400);
    expect(
      (await post("/api/v1/recipe-instances", { recipeId: "r-1", params: null })).statusCode,
    ).toBe(400);
  });

  it("accepts a whitespace-only recipeId (bare `!recipeId` did not trim)", async () => {
    const res = await post("/api/v1/recipe-instances", { recipeId: "   ", params: {} });
    expect(res.statusCode).toBe(201);
  });

  it("201 for a valid create body", async () => {
    const res = await post("/api/v1/recipe-instances", { recipeId: "r-1", params: { a: 1 } });
    expect(res.statusCode).toBe(201);
  });

  // PUT /api/v1/recipe-instances/:id — old: `!params || typeof !== object`
  it("400 when update params is missing or null", async () => {
    expect((await put("/api/v1/recipe-instances/ri-1", {})).statusCode).toBe(400);
    expect((await put("/api/v1/recipe-instances/ri-1", { params: null })).statusCode).toBe(400);
  });

  it("200 for a valid update body", async () => {
    const res = await put("/api/v1/recipe-instances/ri-1", { params: { a: 1 } });
    expect(res.statusCode).toBe(200);
  });

  // POST /api/v1/recipe-instances/:id/actions — old: `!action || typeof !== string`
  it("400 when action is missing or empty", async () => {
    expect((await post("/api/v1/recipe-instances/ri-1/actions", {})).statusCode).toBe(400);
    expect((await post("/api/v1/recipe-instances/ri-1/actions", { action: "" })).statusCode).toBe(
      400,
    );
  });

  it("accepts a whitespace-only action (bare `!action` did not trim)", async () => {
    const res = await post("/api/v1/recipe-instances/ri-1/actions", { action: "   " });
    expect(res.statusCode).toBe(200);
  });
});
