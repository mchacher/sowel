import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerButtonActionRoutes } from "./button-actions.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Input-validation characterization (issue #452): POST/PUT action-bindings.

function makeDeps() {
  const binding = { id: "b-1" };
  return {
    buttonActionManager: {
      getBindingsByEquipment: () => [],
      addBinding: () => binding,
      updateBinding: () => binding,
      removeBinding: () => undefined,
    },
    logger: createLogger("silent").logger,
  } as unknown as Parameters<typeof registerButtonActionRoutes>[1];
}

function buildApp() {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);
  registerButtonActionRoutes(app, makeDeps());
  return app;
}

describe("button-action routes — input validation (characterization)", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => await app.close());

  const postUrl = "/api/v1/equipments/eq-1/action-bindings";
  const putUrl = "/api/v1/equipments/eq-1/action-bindings/b-1";
  const post = (body: unknown) => app.inject({ method: "POST", url: postUrl, payload: body });
  const put = (body: unknown) => app.inject({ method: "PUT", url: putUrl, payload: body });

  it("POST 400 { error } when actionValue or effectType is missing", async () => {
    for (const body of [{ effectType: "mode_activate" }, { actionValue: "1" }]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("POST 400 when effectType is not one of the valid values", async () => {
    const res = await post({ actionValue: "1", effectType: "bogus" });
    expect(res.statusCode).toBe(400);
  });

  it("POST 201 for a valid body (config optional)", async () => {
    const res = await post({ actionValue: "1", effectType: "mode_activate" });
    expect(res.statusCode).toBe(201);
  });

  it("PUT mirrors POST validation and accepts a valid body", async () => {
    expect((await put({ actionValue: "1", effectType: "bogus" })).statusCode).toBe(400);
    expect((await put({ effectType: "zone_order" })).statusCode).toBe(400);
    expect((await put({ actionValue: "1", effectType: "zone_order" })).statusCode).toBe(200);
  });
});
